import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'processResponse',
})
export class ProcessResponsePipe implements PipeTransform {
  transform(value: string, ...args: unknown[]): string {
    // Remove <think> </think> and everything inbetween
    const result = value.replace(/<think>[\s\S]*?<\/think>/g, '');
    return result;
  }
}
