import { Check, ChevronsDownUp, ChevronsUpDown, Download } from "lucide-react";
import type { Artifact, BuildArtifactGroup, DownloadEvent, SectionKey } from "../types";
import { areAllBuildsExpanded } from "../utils";
import { BuildGroup } from "./BuildGroup";

type Props = {
  categories: Record<SectionKey, BuildArtifactGroup[]>;
  loadingInputs: Set<string>;
  rows: Record<string, DownloadEvent>;
  sections: Record<SectionKey, boolean>;
  buildExpanded: Record<string, boolean>;
  onSection: (key: SectionKey) => void;
  hideUncheckedArtifacts: boolean;
  onToggleAllBuilds: () => void;
  onToggleCategoryBuilds: (key: SectionKey) => void;
  onBuildExpanded: (id: string) => void;
  onToggleArtifact: (groupId: string, artifactId: string) => void;
  onToggleGroup: (groupId: string, selected: boolean) => void;
  onToggleFetched: (selected: boolean) => void;
  onDownload: (group: BuildArtifactGroup) => void;
  onDownloadFetched: () => void;
  onCancel: (group: BuildArtifactGroup) => void;
  onRetry: (group: BuildArtifactGroup) => void;
  onRemove: (group: BuildArtifactGroup) => void;
  onProgress: (group: BuildArtifactGroup) => void;
  onConfigureFilters: (group: BuildArtifactGroup) => void;
  onDownloadArtifact: (group: BuildArtifactGroup, artifact: Artifact) => void;
};

const LABELS: Record<SectionKey, string> = { fetched: "Fetched builds", progress: "In-progress downloads", completed: "Download completed", failed: "Download failed" };

export function TaskAccordions(props: Props) {
  const fetchedArtifacts = props.categories.fetched.flatMap((group) => group.artifacts);
  const allFetchedSelected = fetchedArtifacts.length > 0 && fetchedArtifacts.every((artifact) => artifact.selected);
  const selectedFetched = fetchedArtifacts.filter((artifact) => artifact.selected).length;
  const allGroups = Object.values(props.categories).flat();
  const allExpanded = areAllBuildsExpanded(allGroups.map((group) => group.id), props.buildExpanded);
  return (
    <div className="accordion-stack">
      <div className="accordion-controls"><button className="icon-button" title={allExpanded ? "Collapse all builds" : "Expand all builds"} onClick={props.onToggleAllBuilds}>{allExpanded ? <ChevronsDownUp size={17} /> : <ChevronsUpDown size={17} />}</button></div>
      {(Object.keys(LABELS) as SectionKey[]).map((key) => {
        const groups = props.categories[key];
        const categoryExpanded = areAllBuildsExpanded(groups.map((group) => group.id), props.buildExpanded);
        return <section className={`task-accordion ${props.sections[key] ? "open" : ""}`} key={key}>
          <div className="accordion-heading" role="button" tabIndex={0} onClick={() => props.onSection(key)}><span>{LABELS[key]}</span><div className="accordion-summary-actions" onClick={(event) => event.stopPropagation()}><button className="icon-button compact-icon" title={categoryExpanded ? `Collapse all ${LABELS[key].toLowerCase()}` : `Expand all ${LABELS[key].toLowerCase()}`} disabled={!groups.length} onClick={() => props.onToggleCategoryBuilds(key)}>{categoryExpanded ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}</button>{key === "fetched" && <><button className={`secondary-button compact selection-toggle ${allFetchedSelected ? "selected" : ""}`} disabled={!fetchedArtifacts.length} onClick={() => props.onToggleFetched(!allFetchedSelected)}><Check size={15} />{allFetchedSelected ? "Deselect all" : "Select all"}</button><button className="primary-button icon-only" title="Download selected" disabled={!selectedFetched} onClick={props.onDownloadFetched}><Download size={16} /></button></>}</div><strong>{groups.length + (key === "fetched" ? props.loadingInputs.size : 0)}</strong></div>
          {props.sections[key] && <div className="group-list">{key === "fetched" && [...props.loadingInputs].map((input) => <div className="build-group loading" key={input}><div className="group-header"><span className="spinner" /><div><strong>{input}</strong><span>Fetching artifacts...</span></div></div></div>)}{groups.map((group) => <BuildGroup key={group.id} group={group} rows={props.rows} expanded={props.buildExpanded[group.id] ?? true} hideUncheckedArtifacts={key !== "fetched"} onToggleExpanded={() => props.onBuildExpanded(group.id)} onToggleArtifact={(artifactId) => props.onToggleArtifact(group.id, artifactId)} onToggleAll={(selected) => props.onToggleGroup(group.id, selected)} onDownload={() => props.onDownload(group)} onCancel={() => props.onCancel(group)} onRetry={() => props.onRetry(group)} onRemove={() => props.onRemove(group)} onProgress={() => props.onProgress(group)} onConfigureFilters={() => props.onConfigureFilters(group)} onDownloadArtifact={(artifact: Artifact) => props.onDownloadArtifact(group, artifact)} />)}{groups.length === 0 && !(key === "fetched" && props.loadingInputs.size) && <div className="accordion-empty">No {LABELS[key].toLowerCase()}.</div>}</div>}
        </section>;
      })}
    </div>
  );
}
