// Geometry/gesture suites deliberately create the existing fixture through the prompt. A fresh
// page stays empty; this helper stubs generation so these suites never spend provider credits.
export async function createFixtureRoom(page) {
  const scene = await page.evaluate(() => window.sceneStore.getState().scene);
  const reply = route => route.fulfill({ json: { kind: 'create', scene } });
  const noArt = route => route.fulfill({ json: { error: 'Use stock geometry for this test' } });
  await page.route('**/api/scene', reply);
  await page.route('**/api/environment', noArt);
  await page.getByLabel('Prompt', { exact: true }).fill('Create the test room');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => window.__pixelRoom?.().rendering);
  await page.unroute('**/api/scene', reply);
  await page.unroute('**/api/environment', noArt);
}
