import { appendDecisionEvent, decisionStates } from "../core/decisions";
import { buildExportBundle, verifyBundle } from "../core/export";
import { runComparison } from "../core/engine";
import { RULE_VERSION } from "../core/types";
import type {
  BatchInput, Classification, DecisionEvent, ExportBundle, Finding, FindingDecisionState,
  RunReport
} from "../core/types";

interface State {
  input?: BatchInput;
  report?: RunReport;
  bundle?: ExportBundle;
  batchId?: string;
  states?: FindingDecisionState[];
  events: DecisionEvent[];
  source: "server" | "file" | "bundle";
}

const state: State = { events: [], source: "server" };

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element ${selector}`);
  return element;
};

function setStatus(selector: string, message: string, kind: "info" | "error" | "ok" = "info"): void {
  const element = $(selector);
  element.textContent = message;
  element.className = `status ${kind}`;
}

async function api(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  return fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined
  });
}

async function loadBatch(input: BatchInput, source: State["source"], bundledEvents: DecisionEvent[] = []): Promise<void> {
  state.input = input;
  state.source = source;
  state.events = bundledEvents.map((event) => ({ ...event }));
  if (source === "file") {
    const response = await api("/batches/replay", { method: "POST", body: input });
    if (!response.ok) {
      const error = await response.json() as { errors?: string[]; error?: string };
      throw new Error([error.error, ...(error.errors ?? [])].filter(Boolean).join("\n"));
    }
    const payload = await response.json() as { batchId: string; report: RunReport };
    state.report = payload.report;
    state.batchId = payload.batchId;
    state.states = decisionStates({ report: payload.report, events: state.events });
  } else {
    const response = await api("/batches", { method: "POST", body: input });
    const payload = await response.json() as { batchId: string; report: RunReport };
    state.report = payload.report;
    state.batchId = payload.batchId;
    const decisions = await api(`/batches/${payload.batchId}/decisions`);
    state.states = (await decisions.json() as { states: FindingDecisionState[] }).states;
  }
  render();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]!));
}

const KIND_LABEL: Record<string, string> = {
  "focus-destination": "フォーカス移動先",
  "reachable-set": "到達可能集合",
  "semantic-state": "意味的状態",
  "focus-trap": "フォーカストラップ",
  "unreachable-popover": "到達不能ポップオーバー",
  "duplicate-announcement": "live 重複通知"
};

const CONFIDENCE_LABEL: Record<string, string> = {
  exact: "完全一致",
  high: "高",
  medium: "中",
  none: "不一致（追加/消失）"
};

function findingState(findingId: string): FindingDecisionState {
  return state.states?.find((item) => item.findingId === findingId)
    ?? { findingId, classifications: [], conflict: false, history: [] };
}

function render(): void {
  if (!state.report) return;
  $("#rule-version").textContent = `rule ${RULE_VERSION}`;
  $("#batch-id").textContent = `batch ${state.batchId ?? "-"}`;
  for (const id of ["summary", "timeline", "findings", "export-panel"]) {
    document.getElementById(id)!.classList.remove("hidden");
  }
  renderEarliest();
  renderFrames();
  renderFindings();
}

function renderEarliest(): void {
  const report = state.report!;
  const earliest = report.findings[0];
  if (!earliest) {
    $("#earliest").textContent = "分岐はありません。";
    $("#finding-summary").innerHTML = "";
    return;
  }
  const operation = earliest.frameIndex > 0 ? report.operations[earliest.frameIndex - 1] : undefined;
  $("#earliest").innerHTML = `
    <span class="severity ${earliest.severity}">${earliest.severity}</span>
    <strong>${escapeHtml(KIND_LABEL[earliest.kind] ?? earliest.kind)}</strong>
    <span>フレーム ${earliest.frameIndex}</span>
    ${operation ? `<span class="pill">操作 ${earliest.frameIndex}: ${escapeHtml(operation.label ?? operation.type)}</span>` : '<span class="pill">初期状態</span>'}
    <span class="summary-text">${escapeHtml(earliest.summary)}</span>`;
  const counts = new Map<string, number>();
  for (const finding of report.findings) counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  $("#finding-summary").innerHTML = [...counts.entries()]
    .map(([kind, count]) => `<span class="pill">${escapeHtml(KIND_LABEL[kind] ?? kind)} × ${count}</span>`)
    .join("");
}

function describeSig(domId: string | undefined, frameIndex: number, side: "baseline" | "candidate"): string {
  if (!domId) return '<span class="muted">（フォーカスなし）</span>';
  const frame = state.report!.frameReports[frameIndex]!;
  const view = side === "baseline" ? frame.baseline : frame.candidate;
  const sig = view.signatures[domId];
  if (!sig) return `<span class="mono">${escapeHtml(domId)}</span>`;
  const states = [
    sig.states.disabled && "disabled",
    sig.states.checked && "checked",
    sig.states.expanded && "expanded",
    sig.states.pressed && "pressed",
    sig.states.selected && "selected",
    sig.states.readonly && "readonly",
    sig.states.required && "required",
    sig.inShadow && "shadow-DOM"
  ].filter(Boolean).map((s) => `<span class="state-tag">${s}</span>`).join(" ");
  return `<span class="sig"><span class="role">${escapeHtml(sig.role)}</span> “${escapeHtml(sig.name || domId)}”</span> ${states}`;
}

function renderFrames(): void {
  const report = state.report!;
  $("#frames").innerHTML = report.frameReports.map((frame) => {
    const op = frame.index > 0 ? report.operations[frame.index - 1] : undefined;
    const findingsHere = report.findings.filter((finding) => finding.frameIndex === frame.index);
    const focusCell = (side: "baseline" | "candidate") => {
      const view = side === "baseline" ? frame.baseline : frame.candidate;
      const expected = view.expectedFocusTo
        ? describeSig(view.expectedFocusTo, frame.index, side)
        : '<span class="muted">—</span>';
      const observed = describeSig(view.observedFocusTo, frame.index, side);
      const mismatch = view.focusMovedUnexpectedly ? '<span class="state-tag bad">期待と不一致</span>' : "";
      return `<td>
        <div class="focus-line"><span class="label">期待</span> ${expected}</div>
        <div class="focus-line"><span class="label">観測</span> ${observed} ${mismatch}</div>
      </td>`;
    };
    const matchRows = frame.matches.map((match) => {
      const b = match.baselineDomId ? describeSig(match.baselineDomId, frame.index, "baseline") : '<span class="muted">—</span>';
      const c = match.candidateDomId ? describeSig(match.candidateDomId, frame.index, "candidate") : '<span class="muted">—</span>';
      const evidence = [
        match.evidence.stableId && "安定ID",
        match.evidence.name && "名前",
        match.evidence.ancestors > 0 && `祖先×${match.evidence.ancestors}`,
        match.evidence.attrSignature && "属性",
        match.evidence.role && "役割"
      ].filter(Boolean).join(" / ");
      return `<tr>
        <td>${b}</td>
        <td>${c}</td>
        <td><span class="confidence ${match.confidence}">${CONFIDENCE_LABEL[match.confidence] ?? match.confidence}</span>
            <div class="evidence muted">${escapeHtml(evidence)}</div>
            <div class="score muted">score ${match.score.toFixed(2)}</div></td>
      </tr>`;
    }).join("");
    const announcements = (viewName: "baseline" | "candidate") => {
      const items = (viewName === "baseline" ? frame.baseline : frame.candidate).announcements;
      return items.length
        ? `<ul class="announcements">${items.map((item) => `<li>🔊 ${escapeHtml(item.text)}</li>`).join("")}</ul>`
        : "";
    };
    return `<details class="frame ${findingsHere.length ? "has-finding" : ""}" ${frame.index === report.findings[0]?.frameIndex ? "open" : ""}>
      <summary>
        <span class="frame-index">F${frame.index}</span>
        ${op ? `<span class="pill">${escapeHtml(op.label ?? op.type)}</span>` : '<span class="pill">初期状態</span>'}
        ${findingsHere.length ? `<span class="state-tag bad">${findingsHere.length} 件の分岐</span>` : '<span class="muted">分岐なし</span>'}
      </summary>
      <table class="focus-table">
        <thead><tr><th>基线</th><th>候选</th></tr></thead>
        <tbody><tr>${focusCell("baseline")}${focusCell("candidate")}</tr></tbody>
      </table>
      <div class="columns">
        <div><h4>基线 live 通知</h4>${announcements("baseline") || '<span class="muted">なし</span>'}</div>
        <div><h4>候选 live 通知</h4>${announcements("candidate") || '<span class="muted">なし</span>'}</div>
      </div>
      <h4>ノード対応（安定証拠と置信度）</h4>
      <table class="match-table">
        <thead><tr><th>基线</th><th>候选</th><th>置信度/証拠</th></tr></thead>
        <tbody>${matchRows}</tbody>
      </table>
      ${findingsHere.length ? `<div class="frame-findings">${findingsHere.map((f) =>
        `<div class="finding-chip ${f.severity}">${escapeHtml(KIND_LABEL[f.kind] ?? f.kind)}: ${escapeHtml(f.summary)}</div>`
      ).join("")}</div>` : ""}
    </details>`;
  }).join("");
}

function renderFindings(): void {
  const report = state.report!;
  $("#finding-list").innerHTML = report.findings.map((finding) => {
    const decisionState = findingState(finding.id);
    const chips = decisionState.classifications.map((group) =>
      `<span class="state-tag ${group.classification}">${labelOfClassification(group.classification)} × ${group.count}
        (${group.researchers.map(escapeHtml).join(", ")})</span>`
    ).join(" ") || '<span class="muted">未判断</span>';
    const conflict = decisionState.conflict ? '<span class="state-tag conflict">競合（上書きされません）</span>' : "";
    const exemption = decisionState.exemption ? `
      <div class="exemption ${decisionState.exemption.validity.status}">
        <strong>除外:</strong>
        役割 <code>${escapeHtml(decisionState.exemption.scope.role)}</code> ·
        名前 <code>${escapeHtml(decisionState.exemption.scope.accessibleName)}</code> ·
        指紋 <code>${escapeHtml(decisionState.exemption.scope.buildFingerprint)}</code>
        <span class="state-tag ${decisionState.exemption.validity.status === "active" ? "exact" : "bad"}">
          ${validityLabel(decisionState.exemption.validity.status)}
          ${decisionState.exemption.validity.reasons.length ? `— ${decisionState.exemption.validity.reasons.map(escapeHtml).join("；")}` : ""}
        </span>
      </div>` : "";
    const history = decisionState.history.length ? `
      <details class="history"><summary>判断履歴（${decisionState.history.length}）</summary><ul>
        ${decisionState.history.map((event) => `<li>
          <code>#${event.seq}</code> ${event.type === "undo" ? "撤销" : "分類"}
          ${event.classification ? escapeHtml(labelOfClassification(event.classification)) : ""}
          by <strong>${escapeHtml(event.operator)}</strong> — ${escapeHtml(event.reason)}
          ${event.revokes ? `(revokes ${escapeHtml(event.revokes)})` : ""}
          ${event.type === "classify" ? `<button type="button" class="mini" data-undo-event="${escapeHtml(event.id)}">撤销</button>` : ""}
        </li>`).join("")}
      </ul></details>` : "";
    return `<article class="finding ${finding.severity}" data-finding-id="${escapeHtml(finding.id)}">
      <header>
        <span class="severity ${finding.severity}">${finding.severity}</span>
        <span class="kind">${escapeHtml(KIND_LABEL[finding.kind] ?? finding.kind)}</span>
        <span class="muted">F${finding.frameIndex} · ${escapeHtml(finding.scope)}</span>
        ${conflict}
      </header>
      <p>${escapeHtml(finding.summary)}</p>
      <details class="evidence-box">
        <summary>再生証拠</summary>
        <pre>${escapeHtml(JSON.stringify(finding.evidence, null, 2))}</pre>
      </details>
      <div class="decision-row">${chips}</div>
      ${exemption}
      <div class="action-row">
        <input class="reason" type="text" placeholder="判断の理由（必須）" />
        <button data-classify="defect" type="button" class="secondary">欠陥</button>
        <button data-classify="intentional" type="button">意図的（除外を発行）</button>
        <button data-classify="noise" type="button" class="secondary">ノイズ</button>
      </div>
      ${history}
    </article>`;
  }).join("");

  document.querySelectorAll<HTMLElement>(".finding").forEach((card) => {
    const findingId = card.dataset.findingId!;
    card.querySelectorAll<HTMLButtonElement>("button[data-classify]").forEach((button) => {
      button.addEventListener("click", () => classify(findingId, button.dataset.classify as Classification, card));
    });
  });
}

function labelOfClassification(value: Classification): string {
  return value === "defect" ? "欠陥" : value === "intentional" ? "意図的" : "ノイズ";
}

function validityLabel(status: string): string {
  if (status === "active") return "有効";
  if (status === "invalid-fingerprint") return "無効（指紋変化）";
  if (status === "invalid-subject") return "無効（移動/改名）";
  return "取り消し済み";
}

async function classify(findingId: string, classification: Classification, card: HTMLElement): Promise<void> {
  const operator = $<HTMLInputElement>("#operator").value.trim();
  const reason = card.querySelector<HTMLInputElement>("input.reason")!.value.trim();
  if (!operator || !reason) {
    alert("操作者と理由は必須です。");
    return;
  }
  if (state.source === "server") {
    const response = await api(`/batches/${state.batchId}/decisions`, {
      method: "POST",
      body: { type: "classify", findingId, classification, operator, reason }
    });
    if (!response.ok) {
      const error = await response.json() as { error?: string };
      alert(error.error ?? "判断の記録に失敗しました");
      return;
    }
    const payload = await response.json() as { states: FindingDecisionState[] };
    state.states = payload.states;
  } else {
    try {
      const event = appendDecisionEvent(
        { report: state.report!, events: state.events },
        { type: "classify", findingId, classification, operator, reason }
      );
      state.events = [...state.events, event];
      state.states = decisionStates({ report: state.report!, events: state.events });
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  renderFindings();
}

async function undoDecision(event: DecisionEvent): Promise<void> {
  const operator = $<HTMLInputElement>("#operator").value.trim();
  const reason = window.prompt(`撤销 #${event.seq} の理由を入力してください（履歴は残ります）`);
  if (reason === null) return;
  if (!operator || !reason.trim()) {
    alert("操作者と理由は必須です。");
    return;
  }
  if (state.source === "server") {
    const response = await api(`/batches/${state.batchId}/decisions`, {
      method: "POST",
      body: { type: "undo", eventId: event.id, operator, reason: reason.trim() }
    });
    if (!response.ok) {
      const error = await response.json() as { error?: string };
      alert(error.error ?? "撤销に失敗しました");
      return;
    }
    const payload = await response.json() as { states: FindingDecisionState[] };
    state.states = payload.states;
  } else {
    try {
      const undo = appendDecisionEvent(
        { report: state.report!, events: state.events },
        { type: "undo", eventId: event.id, operator, reason: reason.trim() }
      );
      state.events = [...state.events, undo];
      state.states = decisionStates({ report: state.report!, events: state.events });
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  renderFindings();
}

function downloadBundle(bundle: ExportBundle): void {
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gsb-${bundle.report.batchId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportBundle(): Promise<void> {
  if (state.source === "server" && state.batchId) {
    const response = await api(`/batches/${state.batchId}/export`);
    const bundle = (await response.json()) as ExportBundle;
    state.bundle = bundle;
    downloadBundle(bundle);
    return;
  }
  // オフライン（ファイル/エクスポートパッケージ読み込み）でもローカル計算でパッケージ化
  const bundle = buildExportBundle(state.input!, state.report!, state.events);
  state.bundle = bundle;
  downloadBundle(bundle);
}

async function verifyReplay(): Promise<void> {
  if (!state.input) return;
  const recomputed = runComparison(state.input);
  const verification = verifyBundle(
    buildExportBundle(state.input, state.report!, state.events),
    recomputed
  );
  const same = verification.ok;
  setStatus("#verify-status", same
    ? "保存入力と同じ規則で再計算した結果が一致しました（決定論的）"
    : `再計算結果が一致しません：${verification.ok ? "" : verification.errors.join("；")}`,
    same ? "ok" : "error");
}

async function readFile(file: File): Promise<{ input: BatchInput; bundle?: ExportBundle }> {
  const parsed = JSON.parse(await file.text()) as BatchInput | ExportBundle;
  if ("input" in parsed && "report" in parsed && "checksums" in parsed) {
    const bundle = parsed as ExportBundle;
    const recomputed = runComparison(bundle.input);
    const verification = verifyBundle(bundle, recomputed);
    if (!verification.ok) {
      throw new Error(`エクスポートパッケージの検証に失敗しました：${verification.errors.join("；")}`);
    }
    return { input: bundle.input, bundle };
  }
  return { input: parsed as BatchInput };
}

function bindUi(): void {
  $("#load-sample").addEventListener("click", async () => {
    try {
      setStatus("#setup-status", "サンプルを読み込み中…");
      const response = await fetch("/sample-batch.json");
      const input = (await response.json()) as BatchInput;
      await loadBatch(input, "server");
      setStatus("#setup-status", "サンプルをサーバへ保存しました", "ok");
    } catch (error) {
      setStatus("#setup-status", String(error), "error");
    }
  });
  $("#file-input").addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      setStatus("#setup-status", "ファイルを検証中…");
      const { input, bundle } = await readFile(file);
      await loadBatch(input, bundle ? "bundle" : "file", bundle?.decisions ?? []);
      setStatus(
        "#setup-status",
        bundle
          ? `エクスポートパッケージを検証・再計算しました（判断 ${bundle.decisions.length} 件を復元、サーバには保存されません）`
          : "ファイルを試算しました（判断はローカルのみ、サーバには保存されません）",
        "ok"
      );
    } catch (error) {
      setStatus("#setup-status", error instanceof Error ? error.message : String(error), "error");
    }
  });
  $("#export-btn").addEventListener("click", () => { void exportBundle(); });
  $("#verify-btn").addEventListener("click", () => { void verifyReplay(); });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches("button[data-undo-event]")) return;
    const eventId = target.dataset.undoEvent!;
    const decisionEvent = state.states
      ?.flatMap((item) => item.history)
      .find((item) => item.id === eventId && item.type === "classify");
    if (decisionEvent) void undoDecision(decisionEvent);
  });
}

bindUi();
