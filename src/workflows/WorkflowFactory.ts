import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { DataSource } from 'typeorm';
import { Workflow } from '../models/Workflow';
import { Task } from '../models/Task';
import {TaskStatus} from "../workers/taskRunner";

export enum WorkflowStatus {
    Initial = 'initial',
    InProgress = 'in_progress',
    Completed = 'completed',
    Failed = 'failed'
}

interface WorkflowStep {
    taskType: string;
    stepNumber: number;
    dependsOn?: number;
}

interface WorkflowDefinition {
    name: string;
    steps: WorkflowStep[];
}

export class WorkflowFactory {
    constructor(private dataSource: DataSource) {}

    /**
     * Creates a workflow by reading a YAML file and constructing the Workflow and Task entities.
     * @param filePath - Path to the YAML file.
     * @param clientId - Client identifier for the workflow.
     * @param geoJson - The geoJson data string for tasks (customize as needed).
     * @returns A promise that resolves to the created Workflow.
     */
    async createWorkflowFromYAML(filePath: string, clientId: string, geoJson: string): Promise<Workflow> {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const workflowDef = yaml.load(fileContent) as WorkflowDefinition;
        const workflowRepository = this.dataSource.getRepository(Workflow);
        const taskRepository = this.dataSource.getRepository(Task);
        const workflow = new Workflow();
        const relations: Map<number, number> = new Map();

        workflow.clientId = clientId;
        workflow.status = WorkflowStatus.Initial;

        const savedWorkflow = await workflowRepository.save(workflow);
        
        const tasks: Task[] = workflowDef.steps.map(step => {
            const task = new Task();
            task.clientId = clientId;
            task.geoJson = geoJson;
            task.status = TaskStatus.Loaded;
            task.taskType = step.taskType;
            task.stepNumber = step.stepNumber;
            task.workflow = savedWorkflow;
            if(step.dependsOn) {
                relations.set(step.stepNumber, step.dependsOn);
            }
            return task;
        });

        const savedTasks = await taskRepository.save(tasks);

        const tasksWithDependencies: Task[] = [];
        for (const task of savedTasks) {
           task.status = TaskStatus.Queued;
            if (relations.has(task.stepNumber)) {
                const dependencyStepNumber = relations.get(task.stepNumber);
                const dependencyTask = await taskRepository.findOne({ where: { stepNumber: dependencyStepNumber } });
                if (dependencyTask) {
                    task.dependency = dependencyTask;
                }
                tasksWithDependencies.push(task);
            } else {
                task.dependency = null;
                tasksWithDependencies.push(task);
            }
        }

        await taskRepository.save(tasksWithDependencies);

        return savedWorkflow;
    }
}