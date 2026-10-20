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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { DesireErrorDto } from './desires.dto.js';
import {
  CreateDesireMatchDto,
  DesireMatchDto,
  DesireMatchesPageDto,
  MatchCandidatesPageDto,
  MatchCandidatesQueryDto,
  MatchesQueryDto,
  PatchDesireMatchDto,
  CreateSuggestionFeedbackDto,
  DesireSuggestionFeedbackDto,
  DesireSuggestionsPageDto,
  SuggestionsQueryDto,
} from './desire-matches.dto.js';
import { DesireMatchesService } from './desire-matches.service.js';

@ApiTags('desires')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: DesireErrorDto,
  description:
    'INVALID_MATCH_REASON, INVALID_MATCH_RELEVANCE, INVALID_DESIRE_CURSOR or malformed body.',
})
@ApiUnauthorizedResponse({ type: DesireErrorDto, description: 'AUTH_REQUIRED.' })
@ApiNotFoundResponse({
  type: DesireErrorDto,
  description: 'DESIRE_NOT_FOUND, ITEM_NOT_FOUND or MATCH_NOT_FOUND.',
})
@ApiConflictResponse({
  type: DesireErrorDto,
  description: 'MATCH_ALREADY_EXISTS or MATCH_LIMIT_EXCEEDED.',
})
@ApiServiceUnavailableResponse({
  type: DesireErrorDto,
  description: 'DESIRES_UNAVAILABLE or MATCHES_UNAVAILABLE.',
})
@Controller({ path: 'desires/:id/matches', version: '1' })
export class DesireMatchesController {
  constructor(private readonly service: DesireMatchesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List all possessions deliberately matched to a desire with plain-language explanations, derived hints and usability indicators.',
  })
  @ApiOkResponse({
    type: DesireMatchesPageDto,
    description: 'A page of desire matches with item summaries and total count.',
  })
  list(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MatchesQueryDto,
  ): Promise<DesireMatchesPageDto> {
    return this.service.list(owner.id, id, query);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Deliberately connect an owned item to this desire as a potential alternative, with an explainable reason. Never claims equivalence.',
  })
  @ApiCreatedResponse({
    type: DesireMatchDto,
    description: 'The match was created and attached to the desire.',
  })
  create(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateDesireMatchDto,
  ): Promise<DesireMatchDto> {
    return this.service.create(owner.id, id, input);
  }

  @Get('candidates')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Search and list owned inventory candidate items for matching. By default, sold/disposed/lost items are excluded from usable alternatives.',
  })
  @ApiOkResponse({
    type: MatchCandidatesPageDto,
    description: 'A page of candidate inventory items with match status and suggested reasons.',
  })
  candidates(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MatchCandidatesQueryDto,
  ): Promise<MatchCandidatesPageDto> {
    return this.service.candidates(owner.id, id, query);
  }

  @Get('suggestions')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List automatic similarity suggestions for this desire, ranked deterministically with explainable factors and feedback context.',
  })
  @ApiOkResponse({
    type: DesireSuggestionsPageDto,
    description: 'A page of ranked, explainable suggestions from the owner’s inventory.',
  })
  suggestions(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SuggestionsQueryDto,
  ): Promise<DesireSuggestionsPageDto> {
    return this.service.suggestions(owner.id, id, query);
  }

  @Get('suggestions/feedback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List all relevance and dismissal feedback recorded for this desire.',
  })
  @ApiOkResponse({
    type: [DesireSuggestionFeedbackDto],
    description: 'List of recorded feedback entries for this desire.',
  })
  listFeedback(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DesireSuggestionFeedbackDto[]> {
    return this.service.listFeedback(owner.id, id);
  }

  @Post('suggestions/feedback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Record relevance or dismissal feedback on a suggestion for this desire.',
  })
  @ApiCreatedResponse({
    type: DesireSuggestionFeedbackDto,
    description: 'The recorded feedback entry.',
  })
  recordFeedback(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateSuggestionFeedbackDto,
  ): Promise<DesireSuggestionFeedbackDto> {
    return this.service.recordFeedback(owner.id, id, input);
  }

  @Delete('suggestions/feedback/:feedbackId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Reset or remove a relevance/dismissal feedback entry, restoring normal suggestion ranking.',
  })
  @ApiNoContentResponse({
    description: 'The feedback was removed successfully.',
  })
  deleteFeedback(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('feedbackId', ParseUUIDPipe) feedbackId: string,
  ): Promise<void> {
    return this.service.deleteFeedback(owner.id, id, feedbackId);
  }

  @Patch(':matchId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Update a match explanation or record relevance feedback (e.g. marking the possession irrelevant).',
  })
  @ApiOkResponse({
    type: DesireMatchDto,
    description: 'The updated match record.',
  })
  update(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() input: PatchDesireMatchDto,
  ): Promise<DesireMatchDto> {
    return this.service.update(owner.id, id, matchId, input);
  }

  @Delete(':matchId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Remove a match connecting an owned possession to this desire.',
  })
  @ApiNoContentResponse({
    description: 'The match was removed successfully.',
  })
  remove(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
  ): Promise<void> {
    return this.service.remove(owner.id, id, matchId);
  }
}
