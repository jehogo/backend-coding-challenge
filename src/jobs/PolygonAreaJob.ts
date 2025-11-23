import { Job } from './Job';
import { Task } from '../models/Task';
import area from '@turf/area';
import { Geometry, Polygon, MultiPolygon } from 'geojson';

export class PolygonAreaJob implements Job {
    async run(task: Task): Promise<{ output: string, error: boolean }> {
        console.log(`Running polygon area calculation for task ${task.taskId}...`);

        try {
            const inputGeometry: Geometry = JSON.parse(task.geoJson);

            if (inputGeometry.type !== 'Polygon' && inputGeometry.type !== 'MultiPolygon') {
                return {
                    output: `Invalid geometry type: ${inputGeometry.type}. Expected Polygon or MultiPolygon.`,
                    error: true
                };
            }

            const polygonArea = area(inputGeometry as Polygon | MultiPolygon).toString();
            console.log(`The polygon area is ${polygonArea} square meters`);
            return {
                output: polygonArea,
                error: false
            };
        } catch (error: any) {
            return {
                output: `Error running polygon area calculation for task ${task.taskId}: ${error.message}`,
                error: true
            };
        }
    }
}