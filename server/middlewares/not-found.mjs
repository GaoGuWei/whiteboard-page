export function notFound(req, res) {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "API route not found" });
    return;
  }
  res.status(404).type("text/plain; charset=utf-8").send("Not found");
}
