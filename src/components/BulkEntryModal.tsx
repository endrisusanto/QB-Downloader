import { X } from "lucide-react";
import { useState } from "react";

export function BulkEntryModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header"><div><h2>Bulk fetch</h2><span>Separate build IDs with commas or whitespace.</span></div><button className="ghost-icon" title="Close" onClick={onClose}><X size={18} /></button></div>
        <textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="110802692, 110802693 110802694" />
        <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!value.trim()} onClick={() => { onSubmit(value); onClose(); }}>Fetch</button></div>
      </div>
    </div>
  );
}
