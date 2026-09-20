import type { BatchInput, BuildInput, Frame, KeyOpType } from "./types";

const VALID_OPS: ReadonlySet<KeyOpType> = new Set([
  "Tab", "ShiftTab", "Enter", "Space", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Escape"
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkDom(node: unknown, errors: string[], path: string, seen: Set<string>): void {
  if (!isObject(node)) {
    errors.push(`${path}: DOM 节点必须是对象`);
    return;
  }
  const id = node.id;
  if (typeof id !== "string" || !id) errors.push(`${path}: 缺少唯一 id`);
  else if (seen.has(id)) errors.push(`${path}.${id}: DOM id 重复`);
  else seen.add(id);
  if (typeof node.tag !== "string" || !node.tag) errors.push(`${path}.${String(id)}: 缺少 tag`);
  if (node.attrs !== undefined && !isObject(node.attrs)) errors.push(`${path}.${String(id)}: attrs 必须是对象`);
  if (node.text !== undefined && typeof node.text !== "string") errors.push(`${path}.${String(id)}: text 必须是字符串`);
  const children = node.children;
  if (children !== undefined) {
    if (!Array.isArray(children)) errors.push(`${path}.${String(id)}: children 必须是数组`);
    else children.forEach((child, index) => checkDom(child, errors, `${path}.${String(id)}.children[${index}]`, seen));
  }
}

function checkFrame(frame: unknown, errors: string[], buildId: string, expectedIndex: number): Set<string> {
  const domIds = new Set<string>();
  if (!isObject(frame)) {
    errors.push(`${buildId}.frames[${expectedIndex}]: 帧必须是对象`);
    return domIds;
  }
  if (frame.index !== expectedIndex) {
    errors.push(`${buildId}.frames[${expectedIndex}]: 帧 index 必须为 ${expectedIndex}（实际 ${String(frame.index)}）`);
  }
  if (!isObject(frame.dom)) errors.push(`${buildId}.frames[${expectedIndex}]: 缺少 dom 根节点`);
  else checkDom(frame.dom, errors, `${buildId}.frames[${expectedIndex}]`, domIds);
  if (!Array.isArray(frame.ax)) {
    errors.push(`${buildId}.frames[${expectedIndex}]: ax 必须是数组`);
  } else {
    const axIds = new Set<string>();
    frame.ax.forEach((axNode: unknown, axIndex: number) => {
      if (!isObject(axNode)) {
        errors.push(`${buildId}.frames[${expectedIndex}].ax[${axIndex}]: 必须是对象`);
        return;
      }
      if (typeof axNode.id !== "string" || !axNode.id) {
        errors.push(`${buildId}.frames[${expectedIndex}].ax[${axIndex}]: 缺少 id`);
      } else if (axIds.has(axNode.id)) {
        errors.push(`${buildId}.frames[${expectedIndex}].ax[${axIndex}]: ax id 重复`);
      } else {
        axIds.add(axNode.id);
      }
      if (typeof axNode.role !== "string" || !axNode.role) {
        errors.push(`${buildId}.frames[${expectedIndex}].ax[${axIndex}]: 缺少 role`);
      }
      if (axNode.domId !== undefined) {
        if (typeof axNode.domId !== "string" || !domIds.has(axNode.domId)) {
          errors.push(`${buildId}.frames[${expectedIndex}].ax[${axIndex}].domId: 未引用到本帧 DOM 节点`);
        }
      }
    });
  }
  const focus = (frame as unknown as Frame).focus;
  if (focus) {
    for (const key of ["from", "to"] as const) {
      const target = focus[key];
      if (target !== undefined && (typeof target !== "string" || !domIds.has(target))) {
        errors.push(`${buildId}.frames[${expectedIndex}].focus.${key}: 引用了不存在的 DOM 节点 ${String(target)}`);
      }
    }
  }
  if (frame.announcements !== undefined && !Array.isArray(frame.announcements)) {
    errors.push(`${buildId}.frames[${expectedIndex}].announcements: 必须是数组`);
  }
  return domIds;
}

function checkBuild(build: unknown, errors: string[], path: string, operationCount: number): build is BuildInput {
  if (!isObject(build)) {
    errors.push(`${path}: 构建数据必须是对象`);
    return false;
  }
  let ok = true;
  for (const key of ["id", "label", "fingerprint"] as const) {
    if (typeof build[key] !== "string" || !(build[key] as string)) {
      errors.push(`${path}.${key}: 必须是非空字符串`);
      ok = false;
    }
  }
  if (!Array.isArray(build.frames)) {
    errors.push(`${path}.frames: 必须是数组`);
    return false;
  }
  const expectedFrames = operationCount + 1;
  if (build.frames.length !== expectedFrames) {
    errors.push(`${path}.frames: 需要 ${expectedFrames} 帧（${operationCount} 个操作 + 初始帧），实际 ${build.frames.length}`);
    ok = false;
  }
  build.frames.forEach((frame: unknown, index: number) => {
    checkFrame(frame, errors, path, index);
  });
  return ok;
}

export function validateBatch(input: unknown): { ok: true; value: BatchInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ["输入必须是 JSON 对象"] };
  if (input.schemaVersion !== undefined && typeof input.schemaVersion !== "string") {
    errors.push("schemaVersion: 必须是字符串");
  }
  if (!Array.isArray(input.operations) || !input.operations.length) {
    errors.push("operations: 必须是非空数组");
  } else {
    input.operations.forEach((op: unknown, index: number) => {
      if (!isObject(op) || typeof op.type !== "string" || !VALID_OPS.has(op.type as KeyOpType)) {
        errors.push(`operations[${index}].type: 非法键盘操作 ${String(isObject(op) ? op.type : op)}`);
      }
    });
  }
  const operationCount = Array.isArray(input.operations) ? input.operations.length : 0;
  checkBuild(input.baseline, errors, "baseline", operationCount);
  checkBuild(input.candidate, errors, "candidate", operationCount);
  if (isObject(input.baseline) && isObject(input.candidate) && input.baseline.id === input.candidate.id) {
    errors.push("baseline.id 与 candidate.id 不能相同");
  }
  if (input.createdAt !== undefined && typeof input.createdAt !== "string") {
    errors.push("createdAt: 必须是字符串（由调用方提供，引擎不读系统时钟）");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: input as unknown as BatchInput };
}
