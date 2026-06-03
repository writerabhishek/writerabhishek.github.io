import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for JSON parsing
  app.use(express.json());

  // API Proxy Endpoint for Claude Opus Chat
  app.post("/api/chat", async (req, res) => {
    const { model, max_tokens, thinking, effort, messages, stream, customApiKey } = req.body;

    // Retrieve active key: custom override from client header/body OR backend environment variable
    const apiKey = customApiKey || process.env.OPUS_API_KEY;

    if (!apiKey || apiKey === "YOUR_KEY_HERE" || apiKey.trim() === "") {
      return res.status(401).json({
        error: "No valid API key provided. Please set the OPUS_API_KEY environment variable in your server configuration, or input your api key in the model options settings."
      });
    }

    try {
      // Build request payload matching user specification
      const payload: Record<string, any> = {
        model: model || "claude-3-7-opus-20250219",
        max_tokens: max_tokens || 128000,
        messages: messages,
        stream: stream !== false,
      };

      // Add thinking and effort if specified
      if (thinking) {
        payload.thinking = thinking;
      }
      if (effort) {
        payload.effort = effort;
      }

      console.log(`[Proxy] Routing request for model ${payload.model} (stream=${payload.stream})`);

      const response = await fetch("https://opus.abhibots.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Proxy] API error response (Status: ${response.status}):`, errorText);
        try {
          const parsed = JSON.parse(errorText);
          return res.status(response.status).json(parsed);
        } catch {
          return res.status(response.status).json({ error: errorText || "Remote API returned an error." });
        }
      }

      // Handle stream mode
      if (payload.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");

        if (response.body) {
          const reader = response.body.getReader();
          
          // Stream chunks directly back to the client
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            res.write(value);
          }
          res.end();
        } else {
          res.status(500).json({ error: "Remote response body is empty." });
        }
      } else {
        // Non-stream fallback mode
        const jsonResponse = await response.json();
        res.json(jsonResponse);
      }
    } catch (apiErr: any) {
      console.error("[Proxy] Exception during request proxy:", apiErr);
      res.status(500).json({
        error: apiErr.message || "Failed to establish proxy connection to custom Anthropic API."
      });
    }
  });

  // Client static assets & SPA serving via Vite
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("[Server] Vite middleware mounted in active dev mode.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("[Server] Production static file serving active from `/dist`.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] ChatGPT Clone API listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
