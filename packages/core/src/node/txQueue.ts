export interface TxItem {
  msgId: number;
  kind: 'burst' | 'trickle';
}

export interface TxQueue {
  push(item: TxItem): void;
  shift(): TxItem | undefined;
  has(msgId: number): boolean;
  removeMsg(msgId: number): void;
  readonly length: number;
}

export function createTxQueue(): TxQueue {
  let items: TxItem[] = [];
  return {
    push(item) {
      items.push(item);
    },
    shift() {
      return items.shift();
    },
    has(msgId) {
      return items.some((i) => i.msgId === msgId);
    },
    removeMsg(msgId) {
      items = items.filter((i) => i.msgId !== msgId);
    },
    get length() {
      return items.length;
    },
  };
}
