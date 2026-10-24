/**
 * A photo the collage engine places. The web version gets these from the
 * gallery API; on the desktop they are files on this computer — `fileId`
 * names the photo (session id + photo id, or "lokal-…") and the URLs are
 * asset-protocol URLs of its thumbnail and preview.
 */
export interface DriveFile {
  id: string;
  fileId: string;
  fileName: string;
  fileNumber: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  webViewUrl: string | null;
  downloadUrl: string | null;
  order: number;
  recentWork?: { id: string; driveFileId: string | null; isActive: boolean } | null;
}
