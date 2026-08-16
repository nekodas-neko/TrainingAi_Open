export function errorLog(error: unknown, ...args: unknown[]): string {
  const logPrefix = "[ERROR]:";

  const serializedArgs = args
    .map((arg) =>
      typeof arg === "object" ? JSON.stringify(arg) : String(arg).trim(),
    )
    .join(" ");

  const message = serializedArgs
    ? `${logPrefix} ${error} ${serializedArgs}`
    : `${logPrefix} ${error}`;

  console.error(message);

  return message;
}

export function infoLog(message: string, ...args: unknown[]): string {
  const logPrefix = "[INFO]:";

  const serializedArgs = args
    .map((arg) =>
      typeof arg === "object" ? JSON.stringify(arg) : String(arg).trim(),
    )
    .join(" ");

  const fullMessage = serializedArgs
    ? `${logPrefix} ${message} ${serializedArgs}`
    : `${logPrefix} ${message}`;

  console.info(fullMessage);

  return fullMessage;
}
