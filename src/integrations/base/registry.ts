import type { Integration } from "./integration";

type IntegrationConstructor = new (...args: any[]) => Integration;

export class IntegrationRegistry {
  private static integrations = new Map<string, IntegrationConstructor>();

  static register(name: string, integrationClass: IntegrationConstructor): void {
    this.integrations.set(name.toLowerCase(), integrationClass);
  }

  static get(name: string): IntegrationConstructor | undefined {
    return this.integrations.get(name.toLowerCase());
  }

  static getAll(): Map<string, IntegrationConstructor> {
    return new Map(this.integrations);
  }

  static has(name: string): boolean {
    return this.integrations.has(name.toLowerCase());
  }

  static list(): string[] {
    return Array.from(this.integrations.keys());
  }
}