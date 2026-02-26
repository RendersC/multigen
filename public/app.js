const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const clearBtn = document.getElementById("clear");
const btn = document.getElementById("btn");

const copyBtn = document.getElementById("copyPrompt");
const copyStatus = document.getElementById("copyStatus");

const progressWrap = document.getElementById("progressWrap");
const progressText = document.getElementById("progressText");
const progressPct = document.getElementById("progressPct");
const progressBar = document.getElementById("progressBar");

function setStatus(text) {
  statusEl.textContent = text || "";
}

function setLoading(isLoading) {
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Генерирую..." : "Генерировать";
  btn.classList.toggle("opacity-60", isLoading);
  btn.classList.toggle("cursor-not-allowed", isLoading);
}

function setProgress(current, total) {
  if (!progressWrap) return;

  if (!total || total <= 0) {
    progressWrap.classList.add("hidden");
    progressText.textContent = "0/0";
    progressPct.textContent = "0%";
    progressBar.style.width = "0%";
    return;
  }

  progressWrap.classList.remove("hidden");
  progressText.textContent = `${current}/${total}`;

  const pct = Math.round((current / total) * 100);
  progressPct.textContent = `${pct}%`;
  progressBar.style.width = `${pct}%`;
}

function addImageCard(src, idx) {
  if (empty) empty.style.display = "none";

  const wrap = document.createElement("div");
  wrap.className =
    "group rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow transition relative";

  // dark glow effect
  const glow = document.createElement("div");
  glow.className =
    "pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition duration-300";
  glow.style.background =
    "radial-gradient(600px circle at 50% 0%, rgba(255,255,255,0.12), transparent 40%)";

  const img = document.createElement("img");
  img.src = src;
  img.alt = `image-${idx}`;
  img.className = "w-full h-64 object-cover";

  const footer = document.createElement("div");
  footer.className = "p-3 flex items-center justify-between gap-2";

  const label = document.createElement("div");
  label.className = "text-xs text-zinc-400";
  label.textContent = `#${idx}`;

  const a = document.createElement("a");
  a.href = src;
  a.download = `banana_${idx}.png`;
  a.className =
    "text-xs px-2 py-1 rounded-lg border border-zinc-800 hover:border-zinc-600 transition";
  a.textContent = "Download";

  footer.appendChild(label);
  footer.appendChild(a);

  wrap.appendChild(glow);
  wrap.appendChild(img);
  wrap.appendChild(footer);

  // subtle hover border
  wrap.addEventListener("mouseenter", () => wrap.classList.add("border-zinc-600"));
  wrap.addEventListener("mouseleave", () => wrap.classList.remove("border-zinc-600"));

  grid.appendChild(wrap);
}

function clearGrid() {
  grid.innerHTML = "";
  if (empty) empty.style.display = "none";
  setStatus("");
  setProgress(0, 0);
}

clearBtn.addEventListener("click", clearGrid);

// Copy prompt feature
copyBtn?.addEventListener("click", async () => {
  const prompt = document.getElementById("prompt").value;
  try {
    await navigator.clipboard.writeText(prompt);
    copyStatus.textContent = "Скопировано";
    setTimeout(() => (copyStatus.textContent = ""), 1200);
  } catch {
    copyStatus.textContent = "Не удалось скопировать (разреши доступ к буферу)";
    setTimeout(() => (copyStatus.textContent = ""), 2000);
  }
});

// Progress generation: sequential requests (better progress control)
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  const apiKey = document.getElementById("apiKey").value.trim();
  const prompt = document.getElementById("prompt").value.trim();
  const numImagesRaw = document.getElementById("numImages").value;
  const aspectRatio = document.getElementById("aspectRatio").value;
  const resolution = document.getElementById("resolution").value;
  const model = document.getElementById("model").value;

  const total = Math.max(1, Math.min(10, parseInt(numImagesRaw, 10) || 1));

  if (!apiKey || apiKey.length < 10) {
    setStatus("Вставь нормальный API key.");
    return;
  }
  if (!prompt || prompt.length < 2) {
    setStatus("Напиши prompt.");
    return;
  }

  setLoading(true);
  clearGrid();
  setProgress(0, total);
  setStatus("Генерация началась...");

  try {
    // Чтобы показать прогресс красиво — делаем по 1 картинке за запрос.
    // Сервер уже умеет multiple, но здесь мы дергаем по 1 для live-progress.
    for (let i = 1; i <= total; i++) {
      setStatus(`Генерирую ${i}/${total}...`);
      setProgress(i - 1, total);

      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          prompt,
          numImages: 1,
          aspectRatio,
          resolution,
          model
        })
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Request failed");

      // сервер вернёт images: [dataUrl]
      const src = data?.images?.[0];
      if (src) addImageCard(src, i);

      setProgress(i, total);
    }

    setStatus(`Готово: ${total}/${total}`);
  } catch (err) {
    setStatus(`Ошибка: ${err.message}`);
  } finally {
    setLoading(false);
  }
});