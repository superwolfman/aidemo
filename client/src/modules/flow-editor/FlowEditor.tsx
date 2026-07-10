import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { GitBranch, MousePointer2, Save, Workflow } from 'lucide-react';
import { Card, Header, Metric, Status } from '../../components/ui';
import { AppEvents } from '../../platform/events';
import type { ShellContext } from '../../platform/subapps';
import {
  applyCommand,
  createInitialDocument,
  nodeLabels,
  nodePlugins,
  workflowSchema
} from './documentModel';
import type { FlowCommand, FlowDocument, FlowEdge, FlowNode, FlowOperation, FlowPosition, NodeType } from './documentModel';

const storageKey = 'enablement-flow-document-v3';
const nodeWidth = 172;
const nodeHeight = 82;

type EditorState = {
  document: FlowDocument;
  selectedIds: string[];
  undoStack: FlowDocument[];
  redoStack: FlowDocument[];
};

type EditorAction =
  | { type: 'COMMAND'; command: FlowCommand }
  | { type: 'LOAD_DOCUMENT'; document: FlowDocument }
  | { type: 'SELECT'; ids: string[] }
  | { type: 'UNDO' }
  | { type: 'REDO' };

type DragState = {
  nodeId: string;
  start: FlowPosition;
  origin: FlowPosition;
  pointerId: number;
} | null;

type ContextMenuState = {
  x: number;
  y: number;
  nodeId: string;
} | null;

type FlowTemplate = {
  name: string;
  description: string;
  nodes: Array<{ type: NodeType; title: string; x: number; y: number }>;
  edges: Array<[number, number]>;
};

const defaultTemplates: FlowTemplate[] = [
  {
    name: '员工展业线索跟进',
    description: '客户线索进入、AI 画像、企微触达、人工确认和回访任务。',
    nodes: [
      { type: 'start', title: '线索进入', x: 64, y: 120 },
      { type: 'action', title: 'AI 客户画像', x: 304, y: 120 },
      { type: 'condition', title: '意向等级判断', x: 544, y: 120 },
      { type: 'approval', title: '坐席确认话术', x: 784, y: 64 },
      { type: 'action', title: '企微触达客户', x: 1024, y: 64 },
      { type: 'subflow', title: '低意向培育流程', x: 784, y: 210 },
      { type: 'end', title: '生成回访任务', x: 1264, y: 120 }
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 6], [2, 5], [5, 6]]
  },
  {
    name: '营销活动审批流',
    description: '活动方案、预算审批、素材生成、合规审查和灰度发布。',
    nodes: [
      { type: 'start', title: '创建活动方案', x: 64, y: 120 },
      { type: 'approval', title: '预算审批', x: 304, y: 120 },
      { type: 'action', title: '生成投放素材', x: 544, y: 120 },
      { type: 'approval', title: '合规审查', x: 784, y: 120 },
      { type: 'condition', title: '灰度指标判断', x: 1024, y: 120 },
      { type: 'end', title: '全量发布', x: 1264, y: 74 },
      { type: 'subflow', title: '回滚复盘', x: 1264, y: 210 }
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6]]
  }
];

function loadDocument(): FlowDocument {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : createInitialDocument(36);
  } catch {
    return createInitialDocument(36);
  }
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'COMMAND') {
    const nextDoc = applyCommand(state.document, action.command);
    return {
      ...state,
      document: nextDoc,
      undoStack: [...state.undoStack, state.document].slice(-80),
      redoStack: [],
      selectedIds: 'nodeId' in action.command && action.command.nodeId ? [action.command.nodeId] : state.selectedIds
    };
  }

  if (action.type === 'LOAD_DOCUMENT') {
    return {
      ...state,
      document: action.document,
      selectedIds: [],
      undoStack: [...state.undoStack, state.document].slice(-80),
      redoStack: []
    };
  }

  if (action.type === 'SELECT') return { ...state, selectedIds: action.ids };

  if (action.type === 'UNDO' && state.undoStack.length) {
    const previous = state.undoStack[state.undoStack.length - 1];
    return {
      ...state,
      document: previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [state.document, ...state.redoStack].slice(0, 80)
    };
  }

  if (action.type === 'REDO' && state.redoStack.length) {
    const next = state.redoStack[0];
    return {
      ...state,
      document: next,
      undoStack: [...state.undoStack, state.document].slice(-80),
      redoStack: state.redoStack.slice(1)
    };
  }

  return state;
}

function commandLabel(command?: FlowCommand | FlowOperation) {
  if (!command) return '暂无命令';
  if (command.type === 'MOVE_NODE' && command.nodeId) return `MOVE_NODE -> ${command.nodeId.slice(0, 12)}`;
  if (command.type === 'ADD_NODE' && command.nodeType) return `ADD_NODE -> ${nodeLabels[command.nodeType]}`;
  if (command.type === 'CONNECT_NODE') return 'CONNECT_NODE';
  return command.type;
}

function edgePath(source: FlowNode, target: FlowNode) {
  const x1 = source.position.x + nodeWidth;
  const y1 = source.position.y + nodeHeight / 2;
  const x2 = target.position.x;
  const y2 = target.position.y + nodeHeight / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function createCommandNodeId(type: NodeType) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function documentFromTemplate(template: FlowTemplate): FlowDocument {
  const document = createInitialDocument(0);
  const nodes = template.nodes.map((item, index) => ({
    id: `${item.type}-${Date.now()}-${index}`,
    type: item.type,
    parentId: null,
    props: { title: item.title, status: index % 3 === 0 ? 'review' : 'ready' },
    children: [],
    position: { x: item.x, y: item.y },
    version: 1,
    updatedAt: Date.now()
  })) as FlowNode[];
  const edges = template.edges
    .map(([sourceIndex, targetIndex]) => {
      const source = nodes[sourceIndex];
      const target = nodes[targetIndex];
      if (!source || !target) return null;
      return { id: `edge-${source.id}-${target.id}`, source: source.id, target: target.id };
    })
    .filter(Boolean) as FlowDocument['edges'];
  return {
    ...document,
    title: template.name,
    nodes,
    edges,
    opLog: [{ type: 'RESET_DOCUMENT', timestamp: Date.now(), actor: document.meta.clientId }]
  };
}

export default function FlowEditor({ shell }: { shell: ShellContext }) {
  const [state, dispatch] = useReducer(editorReducer, null, () => ({
    document: loadDocument(),
    selectedIds: [],
    undoStack: [],
    redoStack: []
  }));
  const [isComposing, setIsComposing] = useState(false);
  const [dragDraft, setDragDraft] = useState<{ nodeId: string; position: FlowPosition } | null>(null);
  const [lastCommand, setLastCommand] = useState<FlowCommand | undefined>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<FlowTemplate[]>(() => {
    try {
      const stored = localStorage.getItem('enablement-flow-templates');
      return stored ? JSON.parse(stored) : defaultTemplates;
    } catch {
      return defaultTemplates;
    }
  });
  const [templateIndex, setTemplateIndex] = useState(0);
  const [templateDraft, setTemplateDraft] = useState(() => JSON.stringify(defaultTemplates[0], null, 2));
  const workerRef = useRef<Worker | null>(null);
  const dragRef = useRef<DragState>(null);

  const selectedNode = state.document.nodes.find((node) => node.id === state.selectedIds[0]);
  const latestOp = state.document.opLog[state.document.opLog.length - 1];
  const nodeMap = useMemo(() => new Map(state.document.nodes.map((node) => [node.id, node])), [state.document.nodes]);
  const canvasSize = useMemo(() => {
    const maxX = Math.max(...state.document.nodes.map((node) => node.position.x), 900) + 360;
    const maxY = Math.max(...state.document.nodes.map((node) => node.position.y), 520) + 220;
    return { width: maxX, height: maxY };
  }, [state.document.nodes]);

  const emitCommand = useCallback((command: FlowCommand) => {
    setLastCommand(command);
    shell.eventBus.emit(AppEvents.FLOW_COMMAND_EXECUTED, { command });
    dispatch({ type: 'COMMAND', command });
  }, [shell.eventBus]);

  useEffect(() => {
    workerRef.current = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (event: MessageEvent<{ positions: Array<{ id: string; position: FlowPosition }> }>) => {
      emitCommand({ type: 'APPLY_LAYOUT', positions: event.data.positions });
    };
    return () => workerRef.current?.terminate();
  }, [emitCommand]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state.document));
  }, [state.document]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  function selectNode(nodeId: string, multi = false) {
    const ids = multi ? Array.from(new Set([...state.selectedIds, nodeId])) : [nodeId];
    shell.eventBus.emit(AppEvents.FLOW_NODE_SELECTED, { ids });
    dispatch({ type: 'SELECT', ids });
  }

  function positionNear(node?: FlowNode, offset = 1): FlowPosition {
    if (!node) return { x: 88, y: 88 };
    return { x: node.position.x + 230, y: node.position.y + offset * 112 };
  }

  function addNodeAfter(type: NodeType, anchor = selectedNode) {
    const position = positionNear(anchor, type === 'condition' ? 0 : 1);
    const nodeId = createCommandNodeId(type);
    emitCommand({ type: 'ADD_NODE', nodeType: type, nodeId, position });
    if (anchor) {
      emitCommand({ type: 'CONNECT_NODE', sourceId: anchor.id, targetId: nodeId });
    }
  }

  function loadTemplateDraft(index: number) {
    setTemplateIndex(index);
    setTemplateDraft(JSON.stringify(templates[index], null, 2));
  }

  function parseTemplateDraft() {
    const parsed = JSON.parse(templateDraft) as FlowTemplate;
    if (!parsed.name || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      throw new Error('模板需要包含 name / nodes / edges');
    }
    return parsed;
  }

  function previewTemplate() {
    const parsed = parseTemplateDraft();
    dispatch({ type: 'LOAD_DOCUMENT', document: documentFromTemplate(parsed) });
  }

  function saveTemplate() {
    const parsed = parseTemplateDraft();
    const next = [...templates];
    next[templateIndex] = parsed;
    setTemplates(next);
    localStorage.setItem('enablement-flow-templates', JSON.stringify(next));
    dispatch({ type: 'LOAD_DOCUMENT', document: documentFromTemplate(parsed) });
  }

  function autoLayout() {
    workerRef.current?.postMessage({ nodes: state.document.nodes, columns: state.document.nodes.length > 200 ? 8 : 5, gapX: 220, gapY: 132 });
  }

  function updateTitle(value: string) {
    if (!selectedNode || isComposing || value === selectedNode.props.title) return;
    emitCommand({ type: 'UPDATE_NODE', nodeId: selectedNode.id, patch: { title: value } });
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, node: FlowNode) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectNode(node.id, event.shiftKey);
    setContextMenu(null);
    dragRef.current = {
      nodeId: node.id,
      start: { x: event.clientX, y: event.clientY },
      origin: node.position,
      pointerId: event.pointerId
    };
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const dragging = dragRef.current;
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const position = {
      x: Math.max(24, dragging.origin.x + event.clientX - dragging.start.x),
      y: Math.max(24, dragging.origin.y + event.clientY - dragging.start.y)
    };
    setDragDraft({ nodeId: dragging.nodeId, position });
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const dragging = dragRef.current;
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const finalPosition = dragDraft?.nodeId === dragging.nodeId ? dragDraft.position : dragging.origin;
    dragRef.current = null;
    setDragDraft(null);
    if (finalPosition.x !== dragging.origin.x || finalPosition.y !== dragging.origin.y) {
      emitCommand({ type: 'MOVE_NODE', nodeId: dragging.nodeId, position: finalPosition });
    }
  }

  function renderNodePosition(node: FlowNode) {
    return dragDraft?.nodeId === node.id ? dragDraft.position : node.position;
  }

  function openContextMenu(event: MouseEvent<HTMLButtonElement>, node: FlowNode) {
    event.preventDefault();
    event.stopPropagation();
    selectNode(node.id, event.shiftKey);
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }

  function deleteSelected() {
    state.selectedIds.forEach((nodeId) => emitCommand({ type: 'DELETE_NODE', nodeId }));
  }

  function handleShortcut(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    const isMod = event.metaKey || event.ctrlKey;
    if (isMod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      dispatch({ type: 'UNDO' });
    }
    if ((isMod && event.key.toLowerCase() === 'z' && event.shiftKey) || (isMod && event.key.toLowerCase() === 'y')) {
      event.preventDefault();
      dispatch({ type: 'REDO' });
    }
    if (isMod && event.key.toLowerCase() === 'd' && selectedNode) {
      event.preventDefault();
      emitCommand({ type: 'DUPLICATE_NODE', nodeId: selectedNode.id });
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    }
    if (!isMod && event.key.toLowerCase() === 'a') addNodeAfter('action');
    if (!isMod && event.key.toLowerCase() === 'c') addNodeAfter('condition');
    if (!isMod && event.key.toLowerCase() === 'l') autoLayout();
    if (!isMod && event.key.toLowerCase() === 'r') emitCommand({ type: 'RESET_DOCUMENT', size: 36 });
  }

  function connectTo(node: FlowNode) {
    if (!connectSourceId || connectSourceId === node.id) return;
    emitCommand({ type: 'CONNECT_NODE', sourceId: connectSourceId, targetId: node.id });
    setConnectSourceId(null);
  }

  function removeFirstOutgoing(node: FlowNode) {
    const edge = state.document.edges.find((item) => item.source === node.id);
    if (edge) emitCommand({ type: 'DISCONNECT_EDGE', edgeId: edge.id });
  }

  function renderEdges(edges: FlowEdge[]) {
    return edges.map((edge) => {
      const rawSource = nodeMap.get(edge.source);
      const rawTarget = nodeMap.get(edge.target);
      const source = rawSource && dragDraft?.nodeId === rawSource.id ? { ...rawSource, position: dragDraft.position } : rawSource;
      const target = rawTarget && dragDraft?.nodeId === rawTarget.id ? { ...rawTarget, position: dragDraft.position } : rawTarget;
      if (!source || !target) return null;
      const active = state.selectedIds.includes(edge.source) || state.selectedIds.includes(edge.target);
      return (
        <g key={edge.id}>
          <path className={`flow-edge ${active ? 'active' : ''}`} d={edgePath(source, target)} />
          <path className="flow-edge-hit" d={edgePath(source, target)} onDoubleClick={() => emitCommand({ type: 'DISCONNECT_EDGE', edgeId: edge.id })} />
        </g>
      );
    });
  }

  const menuNode = contextMenu ? nodeMap.get(contextMenu.nodeId) : null;

  return (
    <section className="flow-editor-app" tabIndex={0} onKeyDown={handleShortcut}>
      <Header
        title="低代码流程编辑器子应用"
        desc="参考飞书文档的块式编辑体验：右键上下文菜单、快捷键、节点连线、插件节点、命令栈、Worker 布局与离线 opLog。"
        action={<Status status="wujie-local-subapp" />}
      />

      <div className="metric-grid">
        <Metric icon={Workflow} label="节点数" value={state.document.nodes.length} />
        <Metric icon={GitBranch} label="连线数" value={state.document.edges.length} />
        <Metric icon={MousePointer2} label="选区" value={state.selectedIds.length} />
        <Metric icon={Save} label="离线 opLog" value={state.document.opLog.length} />
      </div>

      <div className="editor-architecture-grid">
        <Card title="内核模型" text="Document Model 与渲染层解耦，节点、边、版本和 opLog 是跨端稳定协议。" />
        <Card title="右键操作" text="节点操作来自 Plugin Registry 和 Selection 状态，不再依赖固定 Command Bar。" />
        <Card title="快捷键体系" text="⌘Z/⌘⇧Z 撤销重做，⌘D 复制，A 动作节点，C 条件节点，L 自动布局，Delete 删除。" />
        <Card title="最近命令" text={commandLabel(lastCommand || latestOp)} />
      </div>

      <div className="flow-editor-layout flow-editor-layout-wide">
        <aside className="flow-side-panel">
          <section className="panel">
            <h2>模板库</h2>
            <div className="template-list">
              {templates.map((template, index) => (
                <button key={template.name} className={index === templateIndex ? 'active' : ''} onClick={() => loadTemplateDraft(index)}>
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                </button>
              ))}
            </div>
            <textarea className="template-editor" rows={10} value={templateDraft} onChange={(event) => setTemplateDraft(event.target.value)} />
            <div className="template-actions">
              <button className="secondary-button" onClick={previewTemplate}>预览模板</button>
              <button className="primary-button" onClick={saveTemplate}>保存模板</button>
            </div>
          </section>

          <section className="panel">
            <h2>Plugin Registry</h2>
            <div className="plugin-list">
              {nodePlugins.map((plugin) => (
                <button key={plugin.type} onClick={() => addNodeAfter(plugin.type)}>
                  <strong>{plugin.label}</strong>
                  <span>{plugin.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Selection Inspector</h2>
            {selectedNode ? (
              <div className="form-stack">
                <label>
                  节点标题
                  <input
                    defaultValue={selectedNode.props.title}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={(event) => {
                      setIsComposing(false);
                      updateTitle(event.currentTarget.value);
                    }}
                    onBlur={(event) => updateTitle(event.currentTarget.value)}
                  />
                </label>
                <Card title="节点 Schema" text={`${selectedNode.type} / version ${selectedNode.version} / ${selectedNode.id}`} />
              </div>
            ) : <div className="empty">右键节点打开上下文菜单；双击连线可删除。</div>}
          </section>

          <section className="panel">
            <h2>Schema Inspector</h2>
            <pre className="schema-box">{JSON.stringify(workflowSchema, null, 2)}</pre>
          </section>
        </aside>

        <section className="panel flow-canvas-panel">
          <div className="flow-canvas-toolbar">
            <strong>{state.document.title}</strong>
            <span>{connectSourceId ? '选择目标节点完成连线' : '右键节点执行操作 · 双击连线删除'}</span>
          </div>
          <div className="flow-canvas" onContextMenu={(event) => event.preventDefault()}>
            <div className="flow-canvas-space" style={{ width: canvasSize.width, height: canvasSize.height }}>
              <svg className="flow-edge-layer" width={canvasSize.width} height={canvasSize.height}>
                <defs>
                  <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {renderEdges(state.document.edges)}
              </svg>

              {state.document.nodes.map((node) => {
                const position = renderNodePosition(node);
                return (
                  <button
                    key={node.id}
                    className={`flow-node-card flow-node-${node.type} ${state.selectedIds.includes(node.id) ? 'selected' : ''} ${dragDraft?.nodeId === node.id ? 'dragging' : ''} ${connectSourceId === node.id ? 'connect-source' : ''}`}
                    style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
                    onClick={(event) => {
                      if (connectSourceId && connectSourceId !== node.id) connectTo(node);
                      else selectNode(node.id, event.shiftKey);
                    }}
                    onContextMenu={(event) => openContextMenu(event, node)}
                    onPointerDown={(event) => pointerDown(event, node)}
                    onPointerMove={pointerMove}
                    onPointerUp={pointerUp}
                    onPointerCancel={pointerUp}
                  >
                    <span className="flow-node-type">{nodeLabels[node.type] || node.type}</span>
                    <strong>{node.props.title}</strong>
                    <small>{node.props.status} · v{node.version}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {contextMenu && menuNode ? (
        <div className="flow-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <strong>{menuNode.props.title}</strong>
          <button onClick={() => { emitCommand({ type: 'DUPLICATE_NODE', nodeId: menuNode.id }); setContextMenu(null); }}>复制节点 <kbd>⌘D</kbd></button>
          <button onClick={() => { setConnectSourceId(menuNode.id); setContextMenu(null); }}>设为连线起点</button>
          {connectSourceId && connectSourceId !== menuNode.id ? (
            <button onClick={() => { connectTo(menuNode); setContextMenu(null); }}>连接到此节点</button>
          ) : null}
          <button onClick={() => { removeFirstOutgoing(menuNode); setContextMenu(null); }}>删除第一条出边</button>
          <hr />
          {nodePlugins.map((plugin) => (
            <button key={plugin.type} onClick={() => { addNodeAfter(plugin.type, menuNode); setContextMenu(null); }}>
              下方添加{plugin.label}
            </button>
          ))}
          <hr />
          <button onClick={() => { autoLayout(); setContextMenu(null); }}>自动整理布局 <kbd>L</kbd></button>
          <button onClick={() => { emitCommand({ type: 'RESET_DOCUMENT', size: 36 }); setContextMenu(null); }}>重置示例 <kbd>R</kbd></button>
          <button className="danger-menu-item" onClick={() => { emitCommand({ type: 'DELETE_NODE', nodeId: menuNode.id }); setContextMenu(null); }}>删除节点 <kbd>Del</kbd></button>
        </div>
      ) : null}
    </section>
  );
}
