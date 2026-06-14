import { checkbox, confirm, input, select } from "@inquirer/prompts";

export type Choice<Value extends string> = {
  name: string;
  value: Value;
  description?: string;
  checked?: boolean;
};

export type PromptAdapter = {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  input(message: string, defaultValue?: string): Promise<string>;
  select<Value extends string>(message: string, choices: Choice<Value>[]): Promise<Value>;
  checkbox<Value extends string>(message: string, choices: Choice<Value>[]): Promise<Value[]>;
};

export const inquirerPromptAdapter: PromptAdapter = {
  async confirm(message: string, defaultValue = false): Promise<boolean> {
    return confirm({ message, default: defaultValue });
  },
  async input(message: string, defaultValue = ""): Promise<string> {
    return input({ message, default: defaultValue });
  },
  async select<Value extends string>(message: string, choices: Choice<Value>[]): Promise<Value> {
    return select({ message, choices });
  },
  async checkbox<Value extends string>(
    message: string,
    choices: Choice<Value>[],
  ): Promise<Value[]> {
    return checkbox({ message, choices });
  },
};
