import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from './App';
import { renderWithProviders } from './test/utils';

describe('App', () => {
  test('renders the app title', () => {
    renderWithProviders(<App />);
    expect(screen.getByRole('heading', { name: '拼豆助手' })).toBeInTheDocument();
  });
});
