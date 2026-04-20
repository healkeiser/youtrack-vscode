export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const re = /^(\d+(?:\.\d+)?)(h|m|s)/;
  let rest = trimmed;
  let total = 0;
  let matched = false;

  while (rest.length > 0) {
    const m = re.exec(rest);
    if (!m) return null;
    matched = true;
    const value = Number(m[1]);
    const unit = m[2];
    if (value < 0) return null;
    total += unit === 'h' ? value * 3600 : unit === 'm' ? value * 60 : value;
    rest = rest.slice(m[0].length);
  }

  return matched ? Math.round(total) : null;
}
