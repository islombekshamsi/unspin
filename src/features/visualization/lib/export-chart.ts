/** Export the currently rendered SVG, resolving theme styles before rasterizing. */
export async function downloadChartPng(svg: SVGSVGElement, options: {
  title: string; subtitle: string; note: string; legend: { label: string; color: string }[];
}) {
  const bounds = svg.getBoundingClientRect();
  if (!bounds.width || !bounds.height) throw new Error("The chart must be visible before exporting.");
  await document.fonts.ready;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll("*")];
  const copies = [copy, ...copy.querySelectorAll("*")];
  const properties = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "visibility", "display"];
  originals.forEach((node, i) => {
    const computed = getComputedStyle(node);
    properties.forEach((property) => {
      const value = computed.getPropertyValue(property).replace(/url\(["']?[^)]*#([^"')]+)["']?\)/g, "url(#$1)");
      (copies[i] as SVGElement).style.setProperty(property, value);
    });
  });
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(bounds.width));
  copy.setAttribute("height", String(bounds.height));
  copy.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  const objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The chart image could not be rendered.")); image.src = objectUrl; });
    const width = Math.max(640, bounds.width + 48);
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) throw new Error("Image export is unavailable in this browser.");
    const wrap = (text: string, font: string) => {
      measure.font = font;
      const lines: string[] = []; let line = "";
      for (const word of text.split(/\s+/)) {
        if (line && measure.measureText(`${line} ${word}`).width > width - 48) { lines.push(line); line = word; }
        else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(line);
      return lines;
    };
    const titleLines = wrap(options.title, "600 20px sans-serif");
    const subtitleLines = wrap(options.subtitle, "12px sans-serif");
    const legendLines = options.legend.flatMap((series) => wrap(series.label, "13px sans-serif").map((label) => ({ label, color: series.color })));
    const noteLines = wrap(options.note, "12px sans-serif");
    const top = 24 + titleLines.length * 26 + subtitleLines.length * 18 + legendLines.length * 20 + 12;
    const height = top + bounds.height + 16 + noteLines.length * 18 + 24;
    const canvas = document.createElement("canvas");
    const ratio = Math.min(2, Math.sqrt(16000000 / (width * height)));
    canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image export is unavailable in this browser.");
    ctx.scale(ratio, ratio);
    ctx.fillStyle = getComputedStyle(svg).getPropertyValue("--surface").trim() || "#14171a";
    ctx.fillRect(0, 0, width, height);
    let y = 24;
    ctx.textBaseline = "top"; ctx.fillStyle = "#f4f0e6"; ctx.font = "600 20px sans-serif";
    for (const line of titleLines) { ctx.fillText(line, 24, y); y += 26; }
    ctx.font = "12px sans-serif"; ctx.fillStyle = "#c9c3b6";
    for (const line of subtitleLines) { ctx.fillText(line, 24, y); y += 18; }
    ctx.font = "13px sans-serif";
    for (const line of legendLines) {
      const color = line.color.replace(/var\((--[\w-]+)\)/g, (_, token: string) => getComputedStyle(svg).getPropertyValue(token).trim());
      ctx.fillStyle = color; ctx.fillRect(24, y + 3, 10, 10); ctx.fillStyle = "#f4f0e6"; ctx.fillText(line.label, 42, y); y += 20;
    }
    ctx.drawImage(image, 24, top, bounds.width, bounds.height);
    y = top + bounds.height + 16; ctx.font = "12px sans-serif"; ctx.fillStyle = "#c9c3b6";
    for (const line of noteLines) { ctx.fillText(line, 24, y); y += 18; }
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The chart could not be exported.")), "image/png"));
    const url = URL.createObjectURL(png);
    const link = document.createElement("a");
    link.href = url; link.download = `${options.title.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100) || "unspin"}-graph.png`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally { URL.revokeObjectURL(objectUrl); }
}
