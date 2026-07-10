/**
 * synthdata.routes.ts — relational synthetic data (multi-table, FK-safe).
 *
 * Wire up in src/app.ts:
 *
 *   import synthdataRoutes from './routes/synthdata.routes';
 *   app.use('/api/v1/synthdata', synthdataRoutes);
 */
import { Router } from 'express';
import { authorPlan, generate, list, get, download, remove } from '../controllers/synthdata.controller';
import { jwtAuth } from '../middleware/jwt-auth';

const router = Router();
router.use(jwtAuth);

router.post('/plan', authorPlan);   // DDL + business case (+ provider key) -> plan YAML
router.post('/', generate);         // DDL + plan (or rows for auto mode) -> dataset
router.get('/', list);
router.get('/:id', get);
router.get('/:id/file', download);  // ?format=db|csv|sql
router.delete('/:id', remove);

export default router;
