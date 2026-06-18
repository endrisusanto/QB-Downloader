import { X } from "lucide-react";
import { useState } from "react";
import { FILTER_OPTIONS } from "../constants";

export function FilterSelectionModal({
  buildId,
  initialFilters,
  onSave,
  onClose,
}: {
  buildId: string;
  initialFilters: string[];
  onSave: (filters: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialFilters);

  const toggleFilter = (filter: string) => {
    setSelected((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter]
    );
  };

  return (
    <div className="modal-backdrop">
      <div className="modal filter-selection-modal">
        <div className="modal-header">
          <div>
            <h2>Select Artifact Filters</h2>
            <span>For Build ID: <strong>{buildId}</strong></span>
          </div>
          <button className="ghost-icon" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p style={{ margin: "4px 0 16px 0", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
          Choose which types of artifacts to automatically download for this build when it is completed.
        </p>
        <div className="type-grid" style={{ marginBottom: "20px" }}>
          {FILTER_OPTIONS.map((filter) => (
            <button
              key={filter}
              className={`type-chip ${selected.includes(filter) ? "selected" : ""}`}
              onClick={() => toggleFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              onSave(selected);
              onClose();
            }}
          >
            Save Filters
          </button>
        </div>
      </div>
    </div>
  );
}
