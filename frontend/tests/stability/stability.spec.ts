import { test, expect } from '@playwright/test';

test('Playwright setup sanity check', async ({ page }) => {
  await page.goto('/');
  expect(true).toBeTruthy();
});
