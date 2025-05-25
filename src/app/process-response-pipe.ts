import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'processResponse',
})
export class ProcessResponsePipe implements PipeTransform {
  transform(value: string, ...args: unknown[]): string {
    return process(value);
  }
}
export const process = (value: string) => {
  // Remove <think> </think> and everything inbetween
  const result = value.replace(/<think>[\s\S]*?<\/think>/g, '');
  return result;
};
