// Node-only fixture. The separate Workerd check exercises real HTMLRewriter.
export class FixtureRewriter {
  on(selector, handler) {
    this.handler = handler;
    return this;
  }
  transform(response) {
    const attributes = new Map();
    this.handler.element({ setAttribute: (name, value) => attributes.set(name, value) });
    const content = response.text().then(text => text.replace(/<body(?=\s|>)/i,
      '<body' + [...attributes].map(([name, value]) => ` ${name}="${value}"`).join('')));
    const body = new ReadableStream({ async start(controller) {
      controller.enqueue(new TextEncoder().encode(await content)); controller.close();
    } });
    return new Response(body, { status: response.status, headers: response.headers });
  }
}
