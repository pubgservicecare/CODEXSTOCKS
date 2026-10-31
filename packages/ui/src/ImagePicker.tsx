import { useEffect, useRef, useState } from "react";
import { MAX_IMAGE_BYTES, sniffImageType } from "@codex/shared";
import { Icon } from "./icons";

/** An image chosen in a form but not yet saved. The bytes are what gets uploaded or queued. */
export interface PickedImage {
  name: string;
  size: number;
  mime: string;
  bytes: Uint8Array;
}

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/** Same rules as the upload paths (desktop queue and web upload): type sniffed from the bytes, max 8 MB. */
export async function readPickedImage(file: File): Promise<PickedImage> {
  if (!file.size) throw new Error("The selected file is empty");
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageType(bytes);
  if (!mime) throw new Error("Only JPEG, PNG or WebP images are supported");
  return { name: file.name, size: file.size, mime, bytes };
}

function fmtSize(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Account photo field for the create and edit forms: pick from the computer or drag and drop,
 * preview before saving, change or remove. Nothing is uploaded here; the form does that on save.
 */
export function ImagePicker(props: {
  picked: PickedImage | null;
  onPick: (img: PickedImage | null) => void;
  /** Current saved photo (edit form). */
  existingUrl?: string | null;
  existingRemoved?: boolean;
  onRemoveExisting?: (removed: boolean) => void;
  disabled?: boolean;
}) {
  const { picked, onPick, existingUrl, existingRemoved, onRemoveExisting, disabled } = props;
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picked) return setPreview(null);
    const url = URL.createObjectURL(new Blob([picked.bytes as BlobPart], { type: picked.mime }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [picked]);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      onPick(await readPickedImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const shown = preview ?? (existingUrl && !existingRemoved ? `${existingUrl}?tr=w-800,fo-auto` : null);

  return (
    <div className="img-picker" data-testid="image-picker">
      <div
        className={`img-drop ${drag ? "drag" : ""} ${shown ? "has" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled) void take(e.dataTransfer.files?.[0]);
        }}
      >
        {shown ? (
          <img src={shown} alt={picked ? "Selected account photo preview" : "Current account photo"} />
        ) : (
          <button type="button" className="img-empty" onClick={() => input.current?.click()} disabled={disabled}>
            <span className="icon-tile gold"><Icon name="image" size={18} /></span>
            <b>Add account photo</b>
            <small>Tap to choose, or drag an image here</small>
          </button>
        )}
        {picked && <span className="badge chip-solid img-state">Not saved yet</span>}
      </div>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void take(f);
        }}
      />
      <div className="img-actions">
        <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={disabled}>
          <Icon name="upload" size={14} /> {shown ? "Change photo" : "Choose photo"}
        </button>
        {picked && (
          <button type="button" className="btn sm ghost" onClick={() => (onPick(null), setError(null))} disabled={disabled}>
            <Icon name="x" size={14} /> Remove selection
          </button>
        )}
        {!picked && existingUrl && onRemoveExisting && (
          <button type="button" className="btn sm ghost" onClick={() => onRemoveExisting(!existingRemoved)} disabled={disabled}>
            {existingRemoved ? "Keep current photo" : <><Icon name="trash" size={14} /> Remove photo</>}
          </button>
        )}
      </div>
      <small className="hint">
        {picked ? `${picked.name} · ${fmtSize(picked.size)}` : existingRemoved ? "The current photo will be removed when you save." : "Optional · JPEG, PNG or WebP · max 8 MB"}
      </small>
      {error && <small className="err" role="alert"><Icon name="alert" size={13} />{error}</small>}
    </div>
  );
}
