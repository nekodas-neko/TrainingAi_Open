import type { Directory, File } from 'expo-file-system';
import type { MapTile } from './route-shape';

// OpenStreetMap's standard tiles need no key. Their usage policy asks for an identifying
// User-Agent, visible attribution and no bulk downloading: we fetch only the handful of tiles a
// route being looked at covers, and keep each on the phone so it is fetched once.
const TILE_HOST = 'https://tile.openstreetmap.org';
const USER_AGENT = 'TrainingAI-Preview/1.0 (personal training app)';
const DIRECTORY = 'osm-tiles';
const KEEP = 600;

export const MAP_ATTRIBUTION = '© OpenStreetMap contributors';

type TileId = Pick<MapTile, 'z' | 'x' | 'y'>;
export const tileUrl = (t: TileId) => `${TILE_HOST}/${t.z}/${t.x}/${t.y}.png`;
export const tileFileName = (t: TileId) => `${t.z}-${t.x}-${t.y}.png`;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// A captive portal answers 200 with HTML; only real PNG bytes are worth keeping as a tile.
export const isPng = (bytes: ArrayLike<number>) =>
  bytes.length >= PNG_MAGIC.length && PNG_MAGIC.every((b, i) => bytes[i] === b);

// The device path of a tile, from the phone's own copy or the network. Null when it is in
// neither, which is how offline reads: the caller falls back to the plain panel. Tiles live in the
// app's document folder, not the OS-clearable cache, so a route opened once keeps its map.
export async function loadTile(tile: MapTile, signal?: AbortSignal): Promise<string | null> {
  let downloading: { part: File; file: File } | null = null;
  try {
    const fs = await import('expo-file-system');
    const directory = new fs.Directory(fs.Paths.document, DIRECTORY);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const file = new fs.File(directory, tileFileName(tile));
    if (file.exists) return file.uri;
    // On Android the download writes straight to the path it is given, so an abort or a dropped
    // connection leaves a partial file there. It goes to a `.part` file, which is checked to be a
    // PNG and moved in only on success; a tile at its final name is therefore whole. A failure
    // removes both files, so nothing half-written is ever shown as a tile.
    const part = new fs.File(directory, `${tileFileName(tile)}.part`);
    downloading = { part, file };
    await fs.File.downloadFileAsync(tileUrl(tile), part, {
      headers: { 'User-Agent': USER_AGENT },
      idempotent: true,
      signal,
    });
    if (!isPng(await part.bytes())) throw new Error('not a PNG');
    await part.move(file);
    downloading = null;
    prune(directory);
    return file.uri;
  } catch {
    discard(downloading);
    return null;
  }
}

function discard(downloading: { part: File; file: File } | null) {
  if (!downloading) return;
  for (const f of [downloading.part, downloading.file]) {
    try {
      if (f.exists) f.delete();
    } catch {
      // Best effort: the next view downloads again over whatever is left.
    }
  }
}

// Keeps the newest KEEP tiles (about 10 MB), so the folder cannot grow without bound.
function prune(directory: Directory) {
  try {
    const files = directory.list().filter((e): e is File => 'size' in e && !e.uri.endsWith('.part'));
    if (files.length <= KEEP) return;
    files
      .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))
      .slice(0, files.length - KEEP)
      .forEach((f) => f.delete());
  } catch {
    // Pruning is housekeeping; a failure must not cost the map.
  }
}
