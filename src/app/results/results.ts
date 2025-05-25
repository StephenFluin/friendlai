import { DatePipe, JsonPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Refresher } from '../refresher';
import { statusLookup } from '../home/home';
import { ProcessResponsePipe } from '../process-response-pipe';

export interface Query {
  query: string;
  model: string;
  date: string;
  status: number;
  updated: string;
  result?: string;
  processing_time_ms?: number;
  error_message?: string;
}

@Component({
  selector: 'app-results',
  imports: [DatePipe, JsonPipe, ProcessResponsePipe],
  templateUrl: './results.html',
  styles: ``,
})
export class Results {
  route = inject(ActivatedRoute);
  refreshers = inject(Refresher);
  statusLookup = statusLookup;
  every30 = this.refreshers.getRefresher(30 * 1000);
  query = httpResource<Query>(() => {
    // Auto-refresh
    this.every30();
    return `/api/queries/${this.route.snapshot.params['id']}`;
  });
  constructor() {
    effect(() => {
      console.log('new query value:', this.query.value());
    });
  }
  retry() {
    fetch(`/api/queries/${this.route.snapshot.params['id']}/retry`, {
      method: 'POST',
    });
  }
}
