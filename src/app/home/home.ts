import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [DatePipe, RouterLink],
  templateUrl: './home.html',
})
export class Home {
  router = inject(Router);
  queries = httpResource<any[]>(() => '/api/queries', { defaultValue: [] });

  statusLookup = ['Pending Assignment', 'Processing', 'Success', 'Failed'];
  constructor() {
    this.queries.isLoading();
  }

  send(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const query = formData.get('query');
    const model = formData.get('model');

    // POST to /api/queries with the data
    fetch('/api/queries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, model }),
    })
      .then((response) => response.json())
      .then((data) => {
        console.log('Server Response:', data);
        this.router.navigate(['/r', data.id]);
      })
      .catch((error) => {
        console.error('Error:', error);
      });
  }
}
