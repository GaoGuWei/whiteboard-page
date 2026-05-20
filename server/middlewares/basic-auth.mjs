import { timingSafeEqual } from "node:crypto";
import { BASIC_AUTH_PASSWORD, BASIC_AUTH_USER } from "../config.mjs";

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseAuthHeader(header = "") {
  const [scheme, encoded] = String(header).split(" ");
  if (scheme !== "Basic" || !encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function basicAuth(req, res, next) {
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASSWORD) {
    next();
    return;
  }

  const credentials = parseAuthHeader(req.headers.authorization);
  if (
    credentials &&
    safeEqual(credentials.user, BASIC_AUTH_USER) &&
    safeEqual(credentials.password, BASIC_AUTH_PASSWORD)
  ) {
    next();
    return;
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Whiteboard"');
  res.status(401).json({ error: "Authentication required" });
}
