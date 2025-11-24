import { Router } from 'express';
import { AppDataSource } from '../data-source';
import { WorkflowFactory, WorkflowStatus } from '../workflows/WorkflowFactory'; // Create a folder for factories if you prefer
import { Workflow } from '../models/Workflow';
import { TaskStatus } from '../workers/taskRunner';


const router = Router();

router.get('/:id/status', async (req: any, res: any) => {
    const id = req.params.id;
    
    try {
        const workflowRepository = AppDataSource.getRepository(Workflow);
        const workflow = await workflowRepository.findOne({
            where: { workflowId: id },
            relations: ['tasks']
        });

        if (!workflow) {
            return res.status(404).json({ 
                message: 'Workflow not found' 
            });
        }

        const totalTasks = workflow.tasks?.length || 0;
        const completedTasks = workflow.tasks?.filter(
            task => task.status === TaskStatus.Completed
        ).length || 0;
        const failedTasks = workflow.tasks?.filter(
            task => task.status === TaskStatus.Failed
        ).length || 0;

        res.json({
            workflowId: workflow.workflowId,
            status: workflow.status,
            completedTasks,
            failedTasks,
            totalTasks
        });
    } catch (error: any) {
        console.error('Error getting workflow status:', error);
        res.status(500).json({ 
            message: 'Failed to get workflow status' 
        });
    }
});


router.get('/:id/results', async (req: any, res: any) => {
    const id = req.params.id;
    
    try {
        const workflowRepository = AppDataSource.getRepository(Workflow);
        const workflow = await workflowRepository.findOne({
            where: { workflowId: id },
            relations: ['tasks']
        });

        if (!workflow) {
            return res.status(404).json({ 
                message: 'Workflow not found' 
            });
        }

        if (workflow.status === WorkflowStatus.InProgress || workflow.status === WorkflowStatus.Initial) {
            return res.status(400).json({ 
                message: 'Workflow is not completed yet' 
            });
        }

        return res.json({
            workflowId: workflow.workflowId,
            finalResult: workflow.finalResult
        });
        
    } catch (error: any) {
        console.error('Error getting workflow results:', error);
        res.status(500).json({ 
            message: 'Failed to get workflow results' 
        });
    }
});


export default router;



