import { DatePipe, JsonPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Refresher } from '../refresher';
import { statusLookup } from '../home/home';
import { ProcessResponsePipe } from '../process-response-pipe';
import markdownit from 'markdown-it';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { process } from '../process-response-pipe';

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
  styles: `.spinner {
    display:inline-block;
  width: 1ex;
  height: 1ex;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #09f; /* Or your chosen spinner color */
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}`,
})
export class Results {
  route = inject(ActivatedRoute);
  refreshers = inject(Refresher);
  sanitizer = inject(DomSanitizer);
  statusLookup = statusLookup;

  retrying = false;

  every30 = this.refreshers.getRefresher(30 * 1000);
  query = httpResource<Query>(() => {
    // Auto-refresh
    this.every30();
    return `/api/queries/${this.route.snapshot.params['id']}`;
  });

  renderedResult = computed<SafeHtml | null>(() => {
    let q = this.query.value();
    if (q && q.result) {
      let md = new markdownit();
      return this.sanitizer.bypassSecurityTrustHtml(md.render(process(q.result)));
    } else {
      return null;
    }
  });
  constructor() {
    effect(() => {
      console.log('new query value:', this.query.value());
    });
    effect(() => {
      this.query.value();
      this.retrying = false;
    });
  }
  retry() {
    this.retrying = true;
    fetch(`/api/queries/${this.route.snapshot.params['id']}/retry`, {
      method: 'POST',
    });
  }
}
