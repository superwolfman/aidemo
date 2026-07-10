type LayoutNode = {
  id: string;
};

self.onmessage = (event: MessageEvent<{ nodes: LayoutNode[]; columns?: number; gapX?: number; gapY?: number }>) => {
  const { nodes, columns = 6, gapX = 180, gapY = 92 } = event.data;
  const positions = nodes.map((node, index) => ({
    id: node.id,
    position: {
      x: 32 + (index % columns) * gapX,
      y: 28 + Math.floor(index / columns) * gapY
    }
  }));
  self.postMessage({ positions });
};
