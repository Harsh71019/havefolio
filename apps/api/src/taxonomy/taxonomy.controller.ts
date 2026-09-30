import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import {
  CreateSubcategoryDto,
  DeleteCategoryDto,
  DeleteTagDto,
  ReorderTaxonomyDto,
  TagNameDto,
  TaxonomyNameDto,
  TaxonomySnapshotDto,
  UpdateTaxonomyDto,
} from './taxonomy.dto.js';
import { TaxonomyService } from './taxonomy.service.js';

@ApiTags('taxonomy')
@ApiCookieAuth('ownerSession')
@ApiUnauthorizedResponse({ description: 'Missing, revoked or expired owner session.' })
@ApiBadRequestResponse({ description: 'Invalid DTO, name, hierarchy or replacement.' })
@ApiNotFoundResponse({ description: 'Taxonomy record does not exist for this owner.' })
@ApiConflictResponse({
  description:
    'Duplicate name, retired parent, stale order, capacity, children or replacement/consent required.',
})
@ApiServiceUnavailableResponse({ description: 'Taxonomy storage unavailable; retry later.' })
@Controller({ path: 'taxonomy', version: '1' })
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List this owner’s taxonomy in deterministic display order; maximum 500 entries per kind.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  list(@CurrentOwner() owner: OwnerContext): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.list(owner.id);
  }
  @Post('defaults')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Explicitly seed practical demo categories once; subsequent calls never recreate removed defaults.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  defaults(@CurrentOwner() owner: OwnerContext): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.seedDefaults(owner.id);
  }
  @Post('categories')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create an owner-scoped custom root category.' })
  @ApiCreatedResponse({ type: TaxonomySnapshotDto })
  createCategory(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: TaxonomyNameDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.create(owner.id, 'categories', input.name);
  }
  @Post('subcategories')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Create a subcategory under an active same-owner root; deeper hierarchies are unsupported.',
  })
  @ApiCreatedResponse({ type: TaxonomySnapshotDto })
  createSubcategory(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: CreateSubcategoryDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.create(owner.id, 'subcategories', input.name, input.categoryId);
  }
  @Post('tags')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create a reusable owner-scoped tag.' })
  @ApiCreatedResponse({ type: TaxonomySnapshotDto })
  createTag(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: TagNameDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.create(owner.id, 'tags', input.name);
  }
  @Patch('categories/order')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Atomically reorder the complete root list, including retired entries.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  orderCategories(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: ReorderTaxonomyDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.reorder(owner.id, 'categories', input.ids, input.categoryId);
  }
  @Patch('subcategories/order')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Atomically reorder the complete sibling list of the specified owner root.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  orderSubcategories(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: ReorderTaxonomyDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.reorder(owner.id, 'subcategories', input.ids, input.categoryId);
  }
  @Patch('categories/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Rename, retire or restore a root. Retirement implicitly excludes its children from new choices.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  updateCategory(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateTaxonomyDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.update(owner.id, 'categories', id, input);
  }
  @Patch('subcategories/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Rename, retire or restore a subcategory; restoring requires an active root.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  updateSubcategory(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateTaxonomyDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.update(owner.id, 'subcategories', id, input);
  }
  @Patch('tags/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Rename a reusable tag without changing its item assignments.' })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  updateTag(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: TagNameDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.update(owner.id, 'tags', id, input);
  }
  @Delete('categories/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delete a root with explicit consent for any child removal. In-use roots require an active replacement; items lose subcategory and retain original entry/history.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  deleteCategory(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: DeleteCategoryDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.remove(
      owner.id,
      'categories',
      id,
      input.replacementId,
      false,
      input.removeSubcategories,
    );
  }
  @Delete('subcategories/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delete a subcategory, atomically reassigning in-use items to an active sibling when explicitly supplied.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  deleteSubcategory(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: DeleteCategoryDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.remove(owner.id, 'subcategories', id, input.replacementId);
  }
  @Delete('tags/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delete a tag; in-use tags require explicit relationship removal consent. Items are never deleted.',
  })
  @ApiOkResponse({ type: TaxonomySnapshotDto })
  deleteTag(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: DeleteTagDto,
  ): Promise<TaxonomySnapshotDto> {
    return this.taxonomy.remove(owner.id, 'tags', id, undefined, input.removeRelationships);
  }
}
