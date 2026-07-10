export type NodeType = 'start' | 'approval' | 'condition' | 'action' | 'subflow' | 'end';

export type FlowPosition = {
  x: number;
  y: number;
};

export type FlowNode = {
  id: string;
  type: NodeType;
  parentId: string | null;
  props: {
    title: string;
    status: 'review' | 'ready';
  };
  children: string[];
  position: FlowPosition;
  version: number;
  updatedAt: number;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
};

export type FlowDocument = {
  schemaVersion: string;
  title: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  meta: {
    platform: string;
    sync: string;
    savedAt: number;
    clientId: string;
  };
  opLog: FlowOperation[];
};

export type FlowCommand =
  | { type: 'ADD_NODE'; nodeType: NodeType; position?: FlowPosition; nodeId?: string }
  | { type: 'UPDATE_NODE'; nodeId: string; patch: Partial<FlowNode['props']> }
  | { type: 'MOVE_NODE'; nodeId: string; position: FlowPosition }
  | { type: 'DUPLICATE_NODE'; nodeId: string; offset?: FlowPosition }
  | { type: 'DELETE_NODE'; nodeId: string }
  | { type: 'CONNECT_NODE'; sourceId: string; targetId: string }
  | { type: 'DISCONNECT_EDGE'; edgeId: string }
  | { type: 'APPLY_LAYOUT'; positions: Array<{ id: string; position: FlowPosition }> }
  | { type: 'RESET_DOCUMENT'; size: number };

export type FlowOperation = Partial<FlowCommand> & {
  type: FlowCommand['type'];
  timestamp?: number;
  actor?: string;
  count?: number;
};

export type FlowTransaction = {
  id: string;
  commands: FlowCommand[];
  createdAt: number;
};

export function createNode(type: NodeType, index: number, parentId: string | null = null): FlowNode {
  const id = `${type}-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`;
  return {
    id,
    type,
    parentId,
    props: {
      title: `${nodeLabels[type] || type} ${index + 1}`,
      status: index % 3 === 0 ? 'review' : 'ready'
    },
    children: [],
    position: { x: 0, y: 0 },
    version: 1,
    updatedAt: Date.now()
  };
}

export const nodeLabels = {
  start: '开始节点',
  approval: '审批节点',
  condition: '条件分支',
  action: '动作节点',
  subflow: '子流程',
  end: '结束节点'
} satisfies Record<NodeType, string>;

export const nodePlugins = [
  { type: 'approval', label: '审批', description: '审批流、工单流常用人工确认节点' },
  { type: 'condition', label: '条件', description: '按客户状态、风险等级或渠道分流' },
  { type: 'action', label: '动作', description: '发送企微消息、创建任务、调用 Skill' },
  { type: 'subflow', label: '子流程', description: '支持复杂嵌套流程和复用流程片段' }
] satisfies Array<{ type: NodeType; label: string; description: string }>;

export const workflowSchema = {
  version: 'workflow-document@1.0.0',
  nodeKinds: ['block', 'container', 'inline'],
  requiredNodeFields: ['id', 'type', 'props', 'position', 'version'],
  commandKinds: ['ADD_NODE', 'UPDATE_NODE', 'MOVE_NODE', 'DUPLICATE_NODE', 'DELETE_NODE', 'CONNECT_NODE', 'DISCONNECT_EDGE', 'APPLY_LAYOUT', 'RESET_DOCUMENT'],
  syncProtocol: 'offline-first-oplog-with-crdt-merge'
};

function createClientId() {
  const existing = localStorage.getItem('enablement-flow-client-id');
  if (existing) return existing;
  const next = `client-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  localStorage.setItem('enablement-flow-client-id', next);
  return next;
}

export function createInitialDocument(size = 120): FlowDocument {
  const types: NodeType[] = ['start', 'approval', 'condition', 'action', 'subflow', 'approval', 'action', 'end'];
  const columns = size > 300 ? 8 : 5;
  const nodes = Array.from({ length: size }, (_, index) => ({
    ...createNode(types[index % types.length], index),
    position: {
      x: 48 + (index % columns) * 220,
      y: 48 + Math.floor(index / columns) * 132
    }
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge-${nodes[index].id}-${node.id}`,
    source: nodes[index].id,
    target: node.id
  }));
  return {
    schemaVersion: 'workflow-document@1.0.0',
    title: '员工展业审批流',
    nodes,
    edges,
    meta: {
      platform: 'web-rn-compatible',
      sync: 'crdt-like-oplog',
      savedAt: Date.now(),
      clientId: createClientId()
    },
    opLog: []
  };
}

export function applyCommand(document: FlowDocument, command: FlowCommand): FlowDocument {
  const timestamp = Date.now();
  if (command.type === 'ADD_NODE') {
    const fallback = {
      x: 80 + (document.nodes.length % 5) * 36,
      y: 80 + (document.nodes.length % 5) * 28
    };
    const baseNode = createNode(command.nodeType, document.nodes.length);
    const node = { ...baseNode, id: command.nodeId || baseNode.id, position: command.position || fallback };
    return {
      ...document,
      nodes: [...document.nodes, node],
      opLog: [...document.opLog, { ...command, nodeId: node.id, timestamp }]
    } as FlowDocument;
  }

  if (command.type === 'UPDATE_NODE') {
    return {
      ...document,
      nodes: document.nodes.map((node) => node.id === command.nodeId ? {
        ...node,
        props: { ...node.props, ...command.patch },
        version: node.version + 1,
        updatedAt: timestamp
      } : node),
      opLog: [...document.opLog, { ...command, timestamp }]
    };
  }

  if (command.type === 'MOVE_NODE') {
    return {
      ...document,
      nodes: document.nodes.map((node) => node.id === command.nodeId ? {
        ...node,
        position: command.position,
        version: node.version + 1,
        updatedAt: timestamp
      } : node),
      meta: { ...document.meta, savedAt: timestamp },
      opLog: [...document.opLog, { ...command, timestamp, actor: document.meta.clientId }]
    };
  }

  if (command.type === 'DUPLICATE_NODE') {
    const source = document.nodes.find((node) => node.id === command.nodeId);
    if (!source) return document;
    const offset = command.offset || { x: 36, y: 36 };
    const node = {
      ...createNode(source.type, document.nodes.length, source.parentId),
      props: { ...source.props, title: `${source.props.title} 副本` },
      position: { x: source.position.x + offset.x, y: source.position.y + offset.y },
      children: [...source.children]
    };
    return {
      ...document,
      nodes: [...document.nodes, node],
      edges: [...document.edges, { id: `edge-${source.id}-${node.id}`, source: source.id, target: node.id }],
      opLog: [...document.opLog, { ...command, timestamp, actor: document.meta.clientId }]
    };
  }

  if (command.type === 'DELETE_NODE') {
    return {
      ...document,
      nodes: document.nodes.filter((node) => node.id !== command.nodeId),
      edges: document.edges.filter((edge) => edge.source !== command.nodeId && edge.target !== command.nodeId),
      opLog: [...document.opLog, { ...command, timestamp }]
    };
  }

  if (command.type === 'CONNECT_NODE') {
    if (command.sourceId === command.targetId) return document;
    const edgeId = `edge-${command.sourceId}-${command.targetId}`;
    if (document.edges.some((edge) => edge.id === edgeId)) return document;
    return {
      ...document,
      edges: [...document.edges, { id: edgeId, source: command.sourceId, target: command.targetId }],
      opLog: [...document.opLog, { ...command, timestamp, actor: document.meta.clientId }]
    };
  }

  if (command.type === 'DISCONNECT_EDGE') {
    return {
      ...document,
      edges: document.edges.filter((edge) => edge.id !== command.edgeId),
      opLog: [...document.opLog, { ...command, timestamp, actor: document.meta.clientId }]
    };
  }

  if (command.type === 'APPLY_LAYOUT') {
    const positionMap = new Map(command.positions.map((item) => [item.id, item.position]));
    return {
      ...document,
      nodes: document.nodes.map((node) => positionMap.has(node.id) ? { ...node, position: positionMap.get(node.id) } : node),
      meta: { ...document.meta, savedAt: timestamp },
      opLog: [...document.opLog, { type: command.type, count: command.positions.length, timestamp }]
    };
  }

  if (command.type === 'RESET_DOCUMENT') {
    const next = createInitialDocument(command.size);
    return {
      ...next,
      opLog: [...document.opLog, { ...command, timestamp, actor: document.meta.clientId }]
    };
  }

  return document;
}

export function createTransaction(commands: FlowCommand[]): FlowTransaction {
  return {
    id: `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    commands,
    createdAt: Date.now()
  };
}
