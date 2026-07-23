package com.tableplan.api

import com.tableplan.planning.PlanService
import com.tableplan.planning.MealPlan
import jakarta.validation.Valid
import jakarta.validation.constraints.DecimalMax
import jakarta.validation.constraints.DecimalMin
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class AddPlanItemRequest(
    @field:NotBlank val week: String,
    @field:NotBlank val recipeId: String,
    @field:NotBlank val date: String,
    @field:NotBlank val slot: String,
    @field:DecimalMin("0.25") @field:DecimalMax("100") val servings: Double,
    @field:Size(max = 1_000) val notes: String? = null,
)

data class ServingsRequest(
    @field:DecimalMin("0.25") @field:DecimalMax("100") val servings: Double,
)

data class ClonePlanRequest(@field:NotBlank val targetWeek: String)

@RestController
class PlanController(
    private val plans: PlanService,
) {
    @GetMapping("/api/v1/meal-plans")
    fun get(@RequestParam week: String, authentication: Authentication) =
        plans.getWeek(authentication.principal(), week)

    @PostMapping("/api/v1/meal-plans")
    @ResponseStatus(HttpStatus.CREATED)
    fun add(@Valid @RequestBody request: AddPlanItemRequest, authentication: Authentication): MealPlan =
        plans.addItemToPlan(
            authentication.principal(),
            request.week,
            request.recipeId,
            request.date,
            request.slot,
            request.servings,
            request.notes,
        )

    @GetMapping("/api/v1/meal-plan-items/{itemId}")
    fun itemContext(@PathVariable itemId: String, authentication: Authentication) =
        plans.getItemContext(authentication.principal(), itemId)
            ?: throw ApiException(404, "plan_item_not_found", "Meal-plan item was not found.")

    @DeleteMapping("/api/v1/meal-plan-items/{itemId}")
    fun remove(@PathVariable itemId: String, authentication: Authentication) =
        plans.removeItem(authentication.principal(), itemId)

    @PatchMapping("/api/v1/meal-plan-items/{itemId}")
    fun servings(
        @PathVariable itemId: String,
        @Valid @RequestBody request: ServingsRequest,
        authentication: Authentication,
    ) = plans.updateServings(authentication.principal(), itemId, request.servings)

    @PostMapping("/api/v1/meal-plans/clone-previous")
    @ResponseStatus(HttpStatus.CREATED)
    fun clone(@Valid @RequestBody request: ClonePlanRequest, authentication: Authentication) =
        plans.clonePrevious(authentication.principal(), request.targetWeek)
}
