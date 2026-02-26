import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json({ limit: "2mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Статика (фронт)
app.use(express.static(path.join(__dirname, "public")));

// Простая очередь, чтобы не убить лимиты (одновременно максимум 2 генерации)
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

function pickOneImageFromResponse(resp) {
  // Официальный пример: изображения приходят как inlineData в parts
  // Берём первый найденный base64
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

app.post("/api/generate", async (req, res) => {
  try {
    const {
      apiKey,
      prompt,
      numImages,
      aspectRatio,
      resolution,
      model
    } = req.body || {};

    if (!apiKey || typeof apiKey !== "string" || apiKey.length < 10) {
      return res.status(400).json({ error: "API key is required." });
    }
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 2) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    const n = clampInt(numImages, 1, 10, 1);

    const safeAspect = ([
      "1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"
    ].includes(aspectRatio) ? aspectRatio : "1:1");

    const safeRes = (["1K","2K","4K"].includes(resolution) ? resolution : "1K");

    // По умолчанию Nano Banana Pro:
    const safeModel =
      (model === "gemini-2.5-flash-image" || model === "gemini-3-pro-image-preview")
        ? model
        : "gemini-3-pro-image-preview";

    const ai = new GoogleGenAI({ apiKey });

    const tasks = Array.from({ length: n }, (_, i) =>
      limit(async () => {
        const resp = await ai.models.generateContent({
          model: safeModel,
          contents: prompt,
          config: {
            // Можно поставить ["IMAGE"] (в доках есть такой режим),
            // но оставляем ["TEXT","IMAGE"] максимально совместимо.
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
              aspectRatio: safeAspect,
              // 2K/4K имеет смысл в основном для gemini-3-pro-image-preview
              imageSize: safeRes
            }
          }
        });

        const img = pickOneImageFromResponse(resp);
        if (!img) {
          throw new Error(`No image returned (index ${i}).`);
        }
        return img;
      })
    );

    const images = await Promise.all(tasks);

    // Возвращаем data URL, чтобы фронт сразу показал <img>
    const dataUrls = images.map((x) => `data:${x.mimeType};base64,${x.base64}`);

    res.json({
      model: safeModel,
      aspectRatio: safeAspect,
      resolution: safeRes,
      count: dataUrls.length,
      images: dataUrls
    });
  } catch (err) {
    // Не логируем ключ, просто отдаем ошибку
    const msg = err?.message || "Generation failed.";
    res.status(500).json({ error: msg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Running on http://localhost:${PORT}`);
});