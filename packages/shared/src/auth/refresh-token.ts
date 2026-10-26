// #2076. The shape of a native-app refresh token: base64url, 43–128 characters, where 43 is 32
// random bytes (256 bits), the shortest token accepted. The server refuses to hash or look up
// anything else, and the app refuses to store anything else.
export const REFRESH_TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/
