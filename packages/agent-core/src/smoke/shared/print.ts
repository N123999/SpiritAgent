export function printSmokeSection(title: string, payload: unknown): void {
  console.log(`=== ${title} ===`);
  console.log(JSON.stringify(payload, null, 2));
}