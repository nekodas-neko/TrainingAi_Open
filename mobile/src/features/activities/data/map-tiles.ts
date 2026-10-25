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

// The device path of a tile, from the phone's own copy or the network. Null when it is in
// neither, which is how offline reads: the caller falls back to the plain panel. Tiles live in the
// app's document folder, not the OS-clearable cache, so a route opened once keeps its map.
export async function loadTile(tile: MapTile, signal?: AbortSignal): Promise<string | null> {
  try {
    const fs = await import('expo-file-system');
    const directory = new fs.Directory(fs.Paths.document, DIRECTORY);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const file = new fs.File(directory, tileFileName(tile));
    if (file.exists) return file.uri;
    // The download lands in a temporary place and moves in only on success, so a dropped
    // connection leaves no half tile behind.
    const saved = await fs.File.downloadFileAsync(tileUrl(tile), file, {
      headers: { 'User-Agent': USER_AGENT },
      idempotent: true,
      signal,
    });
    prune(directory);
    return saved.uri;
  } catch {
    return null;
  }
}

// Keeps the newest KEEP tiles (about 10 MB), so the folder cannot grow without bound.
function prune(directory: Directory) {
  try {
    const files = directory.list().filter((e): e is File => 'size' in e);
    if (files.length <= KEEP) return;
    files
      .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))
      .slice(0, files.length - KEEP)
      .forEach((f) => f.delete());
  } catch {
    // Pruning is housekeeping; a failure must not cost the map.
  }
}
