import { vi } from "vitest";

export class Store {
  static load = vi.fn().mockResolvedValue(new Store());
  get = vi.fn().mockResolvedValue(undefined);
  set = vi.fn().mockResolvedValue(undefined);
  save = vi.fn().mockResolvedValue(undefined);
  delete = vi.fn().mockResolvedValue(undefined);
}

export class LazyStore extends Store {}
