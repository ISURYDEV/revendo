import { useState, type ReactNode } from 'react';

/**
 * Drag-and-drop file zone. Wraps content and shows an overlay when files are dragged over.
 * Calls onFiles with an array of absolute paths (Electron passes File.path).
 */
export default function DropZone({
  children,
  onFiles,
  accept = '.pdf,.csv,.png,.jpg,.jpeg,.xlsx',
  label = 'Déposez les fichiers ici'
}: {
  children: ReactNode;
  onFiles: (paths: string[]) => void;
  accept?: string;
  label?: string;
}) {
  const [hovering, setHovering] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHovering(false);
    const paths: string[] = [];
    if (e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i] as File & { path?: string };
        if (f.path) paths.push(f.path);
      }
    }
    if (paths.length > 0) onFiles(paths);
  };

  return (
    <div
      className="relative"
      onDragOver={(e) => { e.preventDefault(); setHovering(true); }}
      onDragLeave={() => setHovering(false)}
      onDrop={handleDrop}
    >
      {children}
      {hovering && (
        <div className="absolute inset-0 bg-brand-50/90 border-4 border-dashed border-brand-500 rounded-lg flex items-center justify-center z-40 pointer-events-none">
          <div className="text-center">
            <div className="text-5xl mb-2">📥</div>
            <div className="text-lg font-bold text-brand-700">{label}</div>
            <div className="text-xs text-slate-600 mt-1">Formats acceptés : {accept}</div>
          </div>
        </div>
      )}
    </div>
  );
}
