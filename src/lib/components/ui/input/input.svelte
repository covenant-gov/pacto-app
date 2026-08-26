<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const inputVariants = tv({
		base: "w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 file:h-6 file:text-sm file:font-medium transition-colors aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
		variants: {
			variant: {
				default:
					"rounded-lg border border-input bg-transparent px-2.5 py-1 text-base focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-input/50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
				ghost:
					"h-auto rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0",
				sidebar:
					"h-7 rounded-md border-0 bg-background px-2.5 pl-7 text-xs focus-visible:ring-3 focus-visible:ring-ring/50",
			},
			size: {
				default: "",
				sm: "h-7 text-xs md:text-xs",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type InputVariant = VariantProps<typeof inputVariants>["variant"];
	export type InputSize = VariantProps<typeof inputVariants>["size"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";

	type InputType = Exclude<HTMLInputTypeAttribute, "file">;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, "type" | "size"> &
			({ type: "file"; files?: FileList } | { type?: InputType; files?: undefined })
	> & {
		variant?: InputVariant;
		size?: InputSize;
	};

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		variant = "default",
		size = "default",
		"data-slot": dataSlot = "input",
		...restProps
	}: Props = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(inputVariants({ variant, size }), className)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(inputVariants({ variant, size }), className)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
