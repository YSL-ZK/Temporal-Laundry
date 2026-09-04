import { z } from "zod";

const datosGovResponseSchema = z.array(z.object({
  valor: z.string(),
  vigenciadesde: z.string(),
})).min(1);

export function parseDatosGovUsdCop(payload: unknown) {
  const record = datosGovResponseSchema.parse(payload)[0];
  const value = Number(record.valor);
  const observedOn = record.vigenciadesde.slice(0, 10);
  if (!Number.isFinite(value) || value < 100 || value > 20_000 || !/^\d{4}-\d{2}-\d{2}$/.test(observedOn)) {
    throw new Error("The Colombian TRM response was invalid");
  }
  return { value, observedOn };
}
function parseCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else value += character;
  }
  cells.push(value);
  return cells;
}

export function parseEcbUsdPerEur(csv: string) {
  const rows = csv.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) throw new Error("The ECB response did not contain a rate");
  const headers = parseCsvLine(rows[0]);
  const periodIndex = headers.indexOf("TIME_PERIOD");
  const valueIndex = headers.indexOf("OBS_VALUE");
  if (periodIndex < 0 || valueIndex < 0) throw new Error("The ECB response format was invalid");
  const values = parseCsvLine(rows.at(-1)!);
  const value = Number(values[valueIndex]);
  const observedOn = values[periodIndex];
  if (!Number.isFinite(value) || value < 0.5 || value > 2.5 || !/^\d{4}-\d{2}-\d{2}$/.test(observedOn)) {
    throw new Error("The ECB exchange rate was invalid");
  }
  return { value, observedOn };
}
