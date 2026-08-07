import auditHandler from "./index.js";

export default async function handler(req, res) {
  // Support format=xlsx and query params
  req.query = { ...req.query, format: "xlsx" };
  return auditHandler(req, res);
}
