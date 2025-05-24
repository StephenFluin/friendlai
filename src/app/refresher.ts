import { Injectable, Signal, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class Refresher {
  // A cache of refreshers so they get reused and synced.
  refreshers: { [key: number]: Signal<number> } = {};

  // An epoch number that increments every 30 seconds to allow auto-refreshing
  getRefresher(ms: number) {
    if (!this.refreshers[ms]) {
      const refresher = signal<number>(0);
      setInterval(() => refresher.update((value) => value + 1), ms);
      this.refreshers[ms] = refresher;
    }
    return this.refreshers[ms];
  }
}
