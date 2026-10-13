export function healthCopy(value: string) {
  return value.replace(/\breadiness\b/gi, (word) =>
    word === 'READINESS' ? 'ENERGY' : word[0] === 'R' ? 'Energy' : 'energy',
  );
}
