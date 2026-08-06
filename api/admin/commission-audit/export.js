import auditHandler from "./index.js";

export default async function handler(req, res) {
  // Force format=xlsx for export endpoint
  req.query = { ...req.query, format: "xlsx" };
  return auditHandler(req, res);
}
