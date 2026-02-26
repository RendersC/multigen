import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

const app = express();

app.use(express.json({ limit: "2mb" })); // для /api/generate
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Frontend static
app.use(express.static(path.join(__dirname, "public")));

// limiter (max 2 concurrent)
function createLimiter(maxConcurrent = 2) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= maxConcurrent) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job()
      .catch(() => {})
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
      next();
    });
}
const limit = createLimiter(2);

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeAspectRatio(v) {
  const allowed = ["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"];
  return allowed.includes(v) ? v : "1:1";
}
function safeResolution(v) {
  return ["1K","2K","4K"].includes(v) ? v : "1K";
}
function safeModel(v) {
  return (v === "gemini-2.5-flash-image" || v === "gemini-3-pro-image-preview")
    ? v
    : "gemini-3-pro-image-preview";
}

function pickOneImageFromResponse(resp) {
  const cand = resp?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return {
        mimeType: part.inlineData.mimeType || "image/png",
        base64: part.inlineData.data
      };
    }
  }
  return null;
}

// ---------- TEXT -> IMAGE ----------
app.post("/api/generate", async (req, res) => {
  try {
    const { apiKey, prompt, numImages, aspectRatio, resolution, model } = req.body || {};

    if (!apiKey || typeof apiKey !== "string" || apiKey.length < 10) {
      return res.status(400).json({ error: "API key is required." });
    }
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 2) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    const n = clampInt(numImages, 1, 10, 1);
    const ar = safeAspectRatio(aspectRatio);
    const reso = safeResolution(resolution);
    const m = safeModel(model);

    const ai = new GoogleGenAI({ apiKey });

    const tasks = Array.from({ length: n }, (_, i) =>
      limit(async () => {
        const resp = await ai.models.generateContent({
          model: m,
          contents: prompt,
          config: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: ar, imageSize: reso }
          }
        });

        const img = pickOneImageFromResponse(resp);
        if (!img) throw new Error(`No image returned (index ${i}).`);
        return img;
      })
    );

    const images = await Promise.all(tasks);
    const dataUrls = images.map((x) => `data:${x.mimeType};base64,${x.base64}`);

    res.json({ mode: "generate", model: m, aspectRatio: ar, resolution: reso, count: dataUrls.length, images: dataUrls });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Generation failed." });
  }
});

// ---------- IMAGE -> IMAGE (EDIT) ----------
app.post("/api/edit", upload.single("image"), async (req, res) => {
  try {
    const apiKey = (req.body.apiKey || "").trim();
    const prompt = (req.body.prompt || "").trim();
    const numImages = req.body.numImages;
    const aspectRatio = req.body.aspectRatio;
    const resolution = req.body.resolution;
    const model = req.body.model;

    if (!apiKey || apiKey.length < 10) return res.status(400).json({ error: "API key is required." });
    if (!prompt || prompt.length < 2) return res.status(400).json({ error: "Prompt is required." });
    if (!req.file) return res.status(400).json({ error: "Image file is required." });

    const n = clampInt(numImages, 1, 10, 1);
    const ar = safeAspectRatio(aspectRatio);
    const reso = safeResolution(resolution);
    const m = safeModel(model);

    const mimeType = req.file.mimetype || "image/png";
    const base64 = req.file.buffer.toString("base64");

    const ai = new GoogleGenAI({ apiKey });

    const tasks = Array.from({ length: n }, (_, i) =>
      limit(async () => {
        const resp = await ai.models.generateContent({
          model: m,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: base64 } },
                { text: prompt }
              ]
            }
          ],
          config: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: ar, imageSize: reso }
          }
        });

        const img = pickOneImageFromResponse(resp);
        if (!img) throw new Error(`No edited image returned (index ${i}).`);
        return img;
      })
    );

    const images = await Promise.all(tasks);
    const dataUrls = images.map((x) => `data:${x.mimeType};base64,${x.base64}`);

    res.json({ mode: "edit", model: m, aspectRatio: ar, resolution: reso, count: dataUrls.length, images: dataUrls });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Edit failed." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on http://localhost:${PORT}`));