import { JsonPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-results',
  imports: [JsonPipe],
  templateUrl: './results.html',
  styles: ``,
})
export class Results {
  route = inject(ActivatedRoute);
  query = httpResource(() => `/api/queries/${this.route.snapshot.params['id']}`);
  constructor() {
    effect(() => {
      console.log('new query value:', this.query.value());
    });
  }
}
