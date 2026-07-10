/**
 * synthdata.controller.ts — relational synthetic data endpoints.
 * Mirrors data-gen.controller.ts conventions: thin controllers over a service.
 */
import type { Request, Response } from 'express';
import * as svc from '../services/synthdata.service';

const userId = (req: Request): string => (req as any).user.id;

export async function authorPlan(req: Request, res: Response) {
  try {
    const { ddl, businessCase, provider, apiKey, model } = req.body ?? {};
    if (!ddl || !businessCase) return res.status(400).json({ error: 'ddl and businessCase are required' });
    const planYaml = await svc.authorPlanWithLLM({ ddl, businessCase, provider, apiKey, model });
    res.json({ planYaml });
  } catch (e: any) { res.status(502).json({ error: e.message }); }
}

export async function generate(req: Request, res: Response) {
  try {
    const { name, ddl, planYaml, businessCase, seed, rows } = req.body ?? {};
    if (!ddl) return res.status(400).json({ error: 'ddl is required' });
    const view = await svc.generateDataset(userId(req), { name, ddl, planYaml, businessCase, seed, rows });
    res.status(201).json(view);
  } catch (e: any) { res.status(422).json({ error: e.message }); }
}

export async function list(req: Request, res: Response) {
  res.json({ datasets: svc.listDatasets(userId(req)) });
}

export async function get(req: Request, res: Response) {
  const d = svc.getDataset(userId(req), req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json(d);
}

export async function download(req: Request, res: Response) {
  try {
    const format = String(req.query.format ?? 'db');
    const file = svc.datasetFile(userId(req), req.params.id, format);
    if (!file) return res.status(404).json({ error: 'not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(file.buffer);
  } catch (e: any) { res.status(422).json({ error: e.message }); }
}

export async function remove(req: Request, res: Response) {
  svc.deleteDataset(userId(req), req.params.id);
  res.status(204).end();
}
